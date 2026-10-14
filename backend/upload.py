"""Upload API: add PDFs / YouTube transcripts to the knowledge base without restarting."""
import functools
import hashlib
import os
import re
import threading
import unicodedata
import uuid

import pymupdf as fitz
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from backend.ingest import fix_ligatures, split_words, video_chunks

router = APIRouter()
UPLOAD_DIR = "data/uploads"
MAX_MB = 40
JOBS: dict = {}
_deps: dict = {}
_lock = threading.Lock()


def configure(embedder, col):
    _deps["embedder"], _deps["col"] = embedder, col
    os.makedirs(UPLOAD_DIR, exist_ok=True)


def _set(job_id, **kw):
    JOBS[job_id].update(kw)


def pdf_chunks(path, kind, doc_id, name):
    out = []
    for i, page in enumerate(fitz.open(path), start=1):
        raw = page.get_text()
        text = (fix_ligatures(raw) if kind == "slides" else unicodedata.normalize("NFKC", raw)).strip()
        if not text:
            continue
        pieces = [text] if kind == "slides" else split_words(text)
        for piece in pieces:
            out.append({"text": piece, "source_type": "slide" if kind == "slides" else "book",
                        "source_name": name, "doc_id": doc_id,
                        "location": f"{'slide' if kind == 'slides' else 'page'} {i}", "loc_num": i,
                        "topic": "none", "topic_name": ""})
    return out


def _index(job_id, chunks, doc_id):
    if not chunks:
        raise ValueError("No extractable text found (scanned PDF?). OCR is not supported yet.")
    _set(job_id, stage="embedding", total=len(chunks))
    emb = _deps["embedder"].encode([c["text"] for c in chunks], normalize_embeddings=True,
                                   batch_size=32).tolist()
    _set(job_id, stage="indexing")
    col = _deps["col"]
    for s in range(0, len(chunks), 500):
        part = chunks[s:s + 500]
        col.add(ids=[f"{doc_id}-{s + i}" for i in range(len(part))],
                documents=[c["text"] for c in part],
                embeddings=emb[s:s + 500],
                metadatas=[{k: v for k, v in c.items() if k != "text"} for c in part])
    _set(job_id, chunks=len(chunks))


def _run(job_id, fn):
    try:
        with _lock:
            fn()
        _set(job_id, status="done", stage="done")
    except Exception as e:
        _set(job_id, status="error", error=str(e))


def _new_job(doc_id, name):
    job_id = uuid.uuid4().hex[:8]
    JOBS[job_id] = {"status": "running", "stage": "queued", "doc_id": doc_id, "name": name,
                    "chunks": 0, "error": None, "note": None}
    return job_id


@router.post("/sources/upload")
async def upload_pdf(bg: BackgroundTasks, file: UploadFile = File(...), kind: str = Form("slides")):
    if kind not in ("slides", "book"):
        raise HTTPException(400, "kind must be 'slides' or 'book'")
    data = await file.read()
    if not (file.filename or "").lower().endswith(".pdf") or not data.startswith(b"%PDF"):
        raise HTTPException(400, "Please upload a PDF")
    if len(data) > MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"PDF larger than {MAX_MB} MB")
    doc_id = "doc" + hashlib.sha1(data).hexdigest()[:10]
    path = os.path.join(UPLOAD_DIR, f"{doc_id}.pdf")
    with open(path, "wb") as f:
        f.write(data)
    job_id = _new_job(doc_id, file.filename)

    def work():
        if _deps["col"].get(where={"doc_id": doc_id}, limit=1)["ids"]:
            _set(job_id, note="Already ingested")
            return
        _set(job_id, stage="extracting")
        _index(job_id, pdf_chunks(path, kind, doc_id, file.filename), doc_id)

    bg.add_task(_run, job_id, work)
    return {"job_id": job_id, "doc_id": doc_id}


class YT(BaseModel):
    url: str


def _video_id(url):
    url = url.strip()
    m = re.search(r"(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})", url)
    if m:
        return m.group(1)
    return url if re.fullmatch(r"[A-Za-z0-9_-]{11}", url) else None


@router.post("/sources/youtube")
def add_youtube(body: YT, bg: BackgroundTasks):
    vid = _video_id(body.url)
    if not vid:
        raise HTTPException(400, "Could not read a YouTube video ID from that link")
    job_id = _new_job("yt" + vid, f"YouTube {vid}")

    def work():
        if _deps["col"].get(where={"source_name": vid}, limit=1)["ids"]:
            _set(job_id, note="Already ingested")
            return
        _set(job_id, stage="extracting")
        chunks = video_chunks(vid)          # raises if the video has no captions
        for c in chunks:
            c.update(doc_id="yt" + vid, topic="none", topic_name="")
        _index(job_id, chunks, "yt" + vid)

    bg.add_task(_run, job_id, work)
    return {"job_id": job_id, "doc_id": "yt" + vid}


@router.get("/sources/jobs/{job_id}")
def job_status(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "Unknown job")
    return JOBS[job_id]


@router.get("/sources")
def list_sources():
    metas = _deps["col"].get(include=["metadatas"])["metadatas"]
    agg = {}
    for m in metas:
        key = (m.get("doc_id") or m["source_name"], m["source_type"])
        e = agg.setdefault(key, {"id": key[0], "type": key[1], "name": m["source_name"],
                                 "chunks": 0, "uploaded": bool(m.get("doc_id"))})
        e["chunks"] += 1
    return sorted(agg.values(), key=lambda e: (e["uploaded"], e["name"]))


@functools.lru_cache(maxsize=256)
def _png(doc_id, n):
    doc = fitz.open(os.path.join(UPLOAD_DIR, f"{doc_id}.pdf"))
    try:
        return doc[n - 1].get_pixmap(dpi=110).tobytes("png")
    finally:
        doc.close()


@router.get("/media/doc/{doc_id}/{n}")
def doc_page(doc_id: str, n: int):
    path = os.path.join(UPLOAD_DIR, f"{doc_id}.pdf")
    if not re.fullmatch(r"doc[0-9a-f]{10}", doc_id) or not os.path.exists(path):
        raise HTTPException(404, "Document not found")
    with fitz.open(path) as d:
        if n < 1 or n > len(d):
            raise HTTPException(404, "Page not found")
    return Response(_png(doc_id, n), media_type="image/png")