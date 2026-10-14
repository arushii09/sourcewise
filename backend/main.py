"""FastAPI backend: source-grounded chat with citations.
    uvicorn backend.main:app --reload --port 8000
 http://localhost:8000/docs to test /chat.
"""
import functools
import json
import os

import chromadb
import pymupdf as fitz
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from groq import Groq
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from backend import learner, upload
from backend.quiz import router as quiz_router

load_dotenv()
MODEL = os.getenv("MODEL_MAIN")
VIDEO_ID = os.getenv("VIDEO_ID")
BOOK_PDF = os.getenv("BOOK_PDF", "data/think_python.pdf")   
GATE_DIST = float(os.getenv("GATE_DIST", "0.45"))            
TOP_K = 6
EXCERPT_WORDS = 220
COURSE_NAME = os.getenv("COURSE_NAME", "Python")
embedder = SentenceTransformer("BAAI/bge-small-en-v1.5")
col = chromadb.PersistentClient(path="chroma_db").get_collection("course")
llm = Groq(api_key=os.getenv("GROQ_API_KEY"))

app = FastAPI(title="Course tutor")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])
app.include_router(quiz_router)
upload.configure(embedder, col)
app.include_router(upload.router)
DECLINE = (f"I can't answer that from the uploaded course material ({COURSE_NAME}). I don't mix in "
           "outside knowledge, so try a question about the uploaded topics.")


class ChatIn(BaseModel):
    question: str
    student: str | None = None

'''
def source_url(meta):
    kind, n = meta["source_type"], meta["loc_num"]
    if kind == "video":
        return f"https://www.youtube.com/embed/{VIDEO_ID}?start={n}&autoplay=1"
    if kind == "slide":
        return f"/media/slide/{n}"
    return f"/media/book/{n}"
'''
def source_url(meta):
    kind, n = meta["source_type"], meta["loc_num"]
    if meta.get("doc_id") and kind != "video":
        return f"/media/doc/{meta['doc_id']}/{n}"
    if kind == "video":
        return f"https://www.youtube.com/embed/{meta['source_name']}?start={n}&autoplay=1"
    if kind == "slide":
        return f"/media/slide/{n}"
    return f"/media/book/{n}"

def retrieve(question):
    res = col.query(query_embeddings=embedder.encode([question], normalize_embeddings=True).tolist(),
                    n_results=TOP_K)
    return list(zip(res["documents"][0], res["metadatas"][0], res["distances"][0]))


def decline(best=None, reason="not_covered"):
    return {"answer": DECLINE, "grounded": False, "citations": [],
            "debug": {"reason": reason, "best_dist": best}}


@app.post("/chat")
def chat(body: ChatIn):
    question = body.question.strip()
    if not question:
        raise HTTPException(400, "Empty question")
    hits = retrieve(question)
    best = round(hits[0][2], 3) if hits else None

    # Gate 1: retrieval similarity
    if not hits or hits[0][2] > GATE_DIST:
        return decline(best, "low_similarity")

    excerpts = "\n\n".join(
        f"[{i}] ({m['location']}, {m['source_type']}) " + " ".join(d.split()[:EXCERPT_WORDS])
        for i, (d, m, _) in enumerate(hits, start=1))
    prompt = (
        #f"You are a tutor for ONE course unit ({COURSE_NAME} recursion and dictionaries). Answer the student's "
        f"You are a tutor for the uploaded course material ({COURSE_NAME}). Answer the student's "
        "question using ONLY the numbered excerpts below. Put the citation marker like [2] inside the answer text right after each claim. "
        "If the excerpts do not contain enough information to answer, set answerable to false. "
        "Never use outside knowledge. Keep the answer under 150 words.\n"
        'Return JSON: {"answerable": true or false, "answer": string, "used": [excerpt numbers you cited]}\n\n'
        f"EXCERPTS:\n{excerpts}\n\nQUESTION: {question}")
    try:
        r = llm.chat.completions.create(
            model=MODEL, temperature=0, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": "You return only valid JSON."},
                      {"role": "user", "content": prompt}])
        out = json.loads(r.choices[0].message.content)
    except Exception as e:  # rate limit, bad JSON, network
        raise HTTPException(503, f"Model call failed: {e}")

    # Gate 2: the model must say the excerpts support the answer, with valid citations
    used = [n for n in out.get("used", []) if isinstance(n, int) and 1 <= n <= len(hits)]
    if not out.get("answerable") or not used:
        return decline(best, "model_declined")

    citations = []
    for n in sorted(set(used)):
        d, m, dist = hits[n - 1]
        citations.append({"n": n, "source_type": m["source_type"], "location": m["location"],
                          "loc_num": m["loc_num"], "topic": m.get("topic_name", ""),
                          "snippet": " ".join(d.split()[:40]), "url": source_url(m)})

        '''
    return {"answer": out["answer"], "grounded": True, "citations": citations,
            "debug": {"reason": "ok", "best_dist": best}}
    if body.student:
        tid = hits[used[0] - 1][1].get("topic")
        if tid and tid != "none":
            learner.nudge_from_chat(body.student, tid)
'''
    resp = {"answer": out["answer"], "grounded": True, "citations": citations,
            "debug": {"reason": "ok", "best_dist": best}}
    if body.student:
        tid = hits[used[0] - 1][1].get("topic")
        if tid and tid != "none":
            learner.nudge_from_chat(body.student, tid)
    return resp

@app.get("/media/slide/{n}")
def slide_image(n: int):
    path = f"data/slides_png/slide_{n}.png"
    if not os.path.exists(path):
        raise HTTPException(404, "Slide image not found")
    return FileResponse(path, media_type="image/png")


@functools.lru_cache(maxsize=1)
def _book():
    return fitz.open(BOOK_PDF)


@functools.lru_cache(maxsize=256)
def _book_png(n):
    return _book()[n - 1].get_pixmap(dpi=110).tobytes("png")


@app.get("/media/book/{n}")
def book_page(n: int):
    if n < 1 or n > len(_book()):
        raise HTTPException(404, "Page not found")
    return Response(_book_png(n), media_type="image/png")


@app.get("/health")
def health():
    return {"ok": True, "chunks": col.count(), "course": COURSE_NAME}