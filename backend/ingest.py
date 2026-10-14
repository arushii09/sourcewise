#Ingest slides, textbook pages and video captions into Chroma.
#python backend\\ingest.py
#Every chunk keeps its origin: slide number, page number, or video start second.

import os
import re
import unicodedata
import chromadb
import pymupdf as fitz 
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from youtube_transcript_api import YouTubeTranscriptApi

load_dotenv()

SLIDES_PDF = "data/lecture6_slides.pdf"  
BOOK_PDF = "data/think_python.pdf"       
BOOK_PAGES = [(61, 71), (125, 136)]           
VIDEO_ID = os.getenv("VIDEO_ID")        

WINDOW_SEC = 45        # video caption window
WORDS_PER_CHUNK = 250  # textbook chunk size
EMBED_MODEL = "BAAI/bge-small-en-v1.5"


def split_words(text, size=WORDS_PER_CHUNK):
    words = text.split()
    return [" ".join(words[i:i + size]) for i in range(0, len(words), size)]


def fix_ligatures(t):
    t = unicodedata.normalize("NFKC", t)
    return re.sub(r"(?<=[a-z])S(?=[a-z])", "ti", t)

def slide_chunks():
    os.makedirs("data/slides_png", exist_ok=True)
    doc = fitz.open(SLIDES_PDF)
    out = []
    for i, page in enumerate(doc, start=1):
        # Save the slide as an image for figure captioning later.
        page.get_pixmap(dpi=110).save(f"data/slides_png/slide_{i}.png")
        text = fix_ligatures(page.get_text()).strip()
        if text:
            out.append({"text": text, "source_type": "slide", "source_name": os.path.basename(SLIDES_PDF),
                        "location": f"slide {i}", "loc_num": i})
    return out


def book_chunks():
    doc = fitz.open(BOOK_PDF)
    out = []
    for start, end in BOOK_PAGES:
        for n in range(start, end + 1):
            text = unicodedata.normalize("NFKC", doc[n - 1].get_text()).strip()
            for piece in split_words(text):
                out.append({"text": piece, "source_type": "book", "source_name": os.path.basename(BOOK_PDF),
                            "location": f"page {n}", "loc_num": n})
    return out


def _get(snip, key):
    # Works whether the library returns objects or dicts.
    return getattr(snip, key) if hasattr(snip, key) else snip[key]

'''
def video_chunks():
    snippets = YouTubeTranscriptApi().fetch(VIDEO_ID)
    out, buf, start = [], [], None

    def flush():
        if buf:
            out.append({"text": " ".join(buf), "source_type": "video", "source_name": VIDEO_ID,
                        "location": f"t={int(start)}s", "loc_num": int(start)})
'''

def video_chunks(video_id=VIDEO_ID):
    snippets = YouTubeTranscriptApi().fetch(video_id)
    out, buf, start = [], [], None
    def flush():
        if buf:
            out.append({"text": " ".join(buf), "source_type": "video", "source_name": video_id,
                        "location": f"t={int(start)}s", "loc_num": int(start)})

    for s in snippets:
        st = _get(s, "start")
        if start is None:
            start = st
        buf.append(_get(s, "text").replace("\n", " "))
        if st - start >= WINDOW_SEC:
            flush()
            buf, start = [], None
    flush()
    return out



def main():
    chunks = slide_chunks() + book_chunks() + video_chunks()
    print(f"Chunks: slides={sum(c['source_type']=='slide' for c in chunks)}, "
          f"book={sum(c['source_type']=='book' for c in chunks)}, "
          f"video={sum(c['source_type']=='video' for c in chunks)}")

    model = SentenceTransformer(EMBED_MODEL)
    embeddings = model.encode([c["text"] for c in chunks], normalize_embeddings=True,
                              show_progress_bar=True).tolist()

    db = chromadb.PersistentClient(path="chroma_db")
    try:
        db.delete_collection("course")
    except Exception:
        pass
    col = db.create_collection("course", metadata={"hnsw:space": "cosine"})
    col.add(
        ids=[f"{c['source_type']}-{i}" for i, c in enumerate(chunks)],
        documents=[c["text"] for c in chunks],
        embeddings=embeddings,
        metadatas=[{k: v for k, v in c.items() if k != "text"} for c in chunks],
    )
    print("Stored", col.count(), "chunks in chroma_db")


if __name__ == "__main__":
    main()