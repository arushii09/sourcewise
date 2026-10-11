"""Caption slide images with a vision model and add the descriptions to Chroma as searchable chunks.

Order of the pipeline:  ingest.py  ->  caption_slides.py  ->  tag_topics.py
project root:  python backend\\caption_slides.py

- Plain-text slides get the reply NONE and are skipped (their text is already in Chroma).
- Captions are cached in slide_captions.json, so reruns are free and the script can resume
  if you hit a rate limit.
- Re-running ingest.py wipes these chunks; just run this script again (it reads the cache).
"""
import base64
import glob
import json
import os
import re
import time

import chromadb
from dotenv import load_dotenv
from groq import Groq, RateLimitError
from sentence_transformers import SentenceTransformer

load_dotenv()
MODEL = os.getenv("MODEL_VISION", "qwen/qwen3.8-27b")
CACHE_FILE = "slide_captions.json"
PROMPT = (
    "This is one slide from a Python lecture on recursion and dictionaries. If it contains a diagram, "
    "figure, table, call-stack drawing, tree, or screenshot that carries information beyond its plain text, "
    "describe that visual in 2-3 sentences: what it shows, its labels, and how the parts relate. "
    "If the slide is only plain text or code, reply exactly: NONE")

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
cache = json.load(open(CACHE_FILE, encoding="utf-8")) if os.path.exists(CACHE_FILE) else {}


def save_cache():
    json.dump(cache, open(CACHE_FILE, "w", encoding="utf-8"), indent=1)


def caption(path):
    img = base64.b64encode(open(path, "rb").read()).decode()
    for _ in range(5):
        try:
            r = client.chat.completions.create(
                model=MODEL, temperature=0, max_tokens=500,
                messages=[{"role": "user", "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img}"}}]}])
            text = r.choices[0].message.content or ""
            return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
        except RateLimitError:
            print("  rate limited, waiting 30s...")
            time.sleep(30)
    return None  # give up for now; rerun later and the cache will resume


def main():
    files = sorted(glob.glob("data/slides_png/slide_*.png"),
                   key=lambda p: int(re.search(r"slide_(\d+)\.png", p).group(1)))
    if not files:
        raise SystemExit("No slide images found. Run ingest.py first.")

    stopped = False
    for p in files:
        n = re.search(r"slide_(\d+)\.png", p).group(1)
        if n in cache:
            continue
        text = caption(p)
        if text is None:
            print(f"Stopped at slide {n} (rate limit). Rerun later; progress is saved.")
            stopped = True
            break
        cache[n] = text
        save_cache()
        print(f"slide {n}: {'(no figure)' if text.upper().startswith('NONE') else text[:90]}")
        time.sleep(1)

    col = chromadb.PersistentClient(path="chroma_db").get_collection("course")
    src = col.get(where={"source_type": "slide"}, limit=1, include=["metadatas"])["metadatas"][0]["source_name"]
    items = [(int(n), t) for n, t in cache.items() if t and not t.upper().startswith("NONE")]
    if not items:
        print("No figure captions to add.")
        return
    texts = [f"Figure on slide {n}: {t}" for n, t in items]
    model = SentenceTransformer("BAAI/bge-small-en-v1.5")
    col.upsert(
        ids=[f"figure-{n}" for n, _ in items],
        documents=texts,
        embeddings=model.encode(texts, normalize_embeddings=True).tolist(),
        metadatas=[{"source_type": "slide", "source_name": src, "location": f"slide {n}",
                    "loc_num": n, "is_figure": True} for n, _ in items])
    print(f"Added {len(items)} figure chunks. Now run tag_topics.py so they get topics."
          + (" (Some slides are still uncaptioned; rerun this script later.)" if stopped else ""))


if __name__ == "__main__":
    main()