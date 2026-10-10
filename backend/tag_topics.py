"""Build the topic outline (topics, concepts, prerequisites) and tag every chunk.

Run from the project root:  python backend\\tag_topics.py
1) Builds topics.json from the ingested chunks (skipped if topics.json already exists).
2) Pauses so you can read/edit topics.json.
3) Tags every chunk in Chroma with topic + concepts.
All model replies are cached in llm_cache.json, so re-runs cost nothing.
WARNING: re-running ingest.py wipes the tags; run this script again afterwards.
"""
import hashlib
import json
import os
import time

import chromadb
from dotenv import load_dotenv
from groq import Groq, RateLimitError

load_dotenv()
MODEL = os.getenv("MODEL_MAIN")
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

CACHE_FILE = "llm_cache.json"
TOPICS_FILE = "topics.json"
OUTLINE_BATCH = 20      # chunks per outline call
OUTLINE_WORDS = 60      # words of each chunk shown in outline calls
TAG_BATCH = 10          # chunks per tagging call
TAG_WORDS = 120         # words of each chunk shown in tagging calls

cache = json.load(open(CACHE_FILE, encoding="utf-8")) if os.path.exists(CACHE_FILE) else {}


def llm_json(prompt, attempt=0):
    """Call the model in JSON mode, with disk cache, rate-limit waits and one retry on bad JSON."""
    key = hashlib.sha256(f"{MODEL}|{attempt}|{prompt}".encode()).hexdigest()
    if key not in cache:
        for wait in range(6):
            try:
                r = client.chat.completions.create(
                    model=MODEL, temperature=0, response_format={"type": "json_object"},
                    messages=[{"role": "system", "content": "You return only valid JSON."},
                              {"role": "user", "content": prompt}])
                cache[key] = r.choices[0].message.content
                json.dump(cache, open(CACHE_FILE, "w", encoding="utf-8"))
                break
            except RateLimitError:
                print("  rate limited, waiting 20s...")
                time.sleep(20)
        else:
            raise RuntimeError("Still rate limited; try again in a few minutes.")
    try:
        return json.loads(cache[key])
    except json.JSONDecodeError:
        if attempt == 0:
            return llm_json(prompt, attempt=1)
        raise


def short(text, n):
    return " ".join(text.split()[:n])


def build_outline(docs):
    # 1a: candidate topics per batch of chunks
    candidates = []
    for i in range(0, len(docs), OUTLINE_BATCH):
        batch = docs[i:i + OUTLINE_BATCH]
        excerpts = "\n".join(f"[{j}] {short(d, OUTLINE_WORDS)}" for j, d in enumerate(batch))
        out = llm_json(
            "Below are excerpts from a lecture video, slides and a textbook about Python recursion "
            "and dictionaries. List the distinct topics and key concepts that appear in them. "
            'Return JSON: {"topics":[{"name": str, "concepts": [str]}]}. '
            "Use only what the excerpts contain.\n\n" + excerpts)
        candidates += out.get("topics", [])
        print(f"  outline batch {i // OUTLINE_BATCH + 1}/{-(-len(docs) // OUTLINE_BATCH)} done")

    # 1b: consolidate into a clean course outline
    out = llm_json(
        "Consolidate these candidate topics into 6 to 10 course topics for a mastery tracker. "
        "List them in learning order (foundations first). Return JSON: "
        '{"topics":[{"id": snake_case_str, "name": str, "concepts": [3 to 6 short str], '
        '"prerequisites": [ids of topics listed EARLIER]}]}. '
        "Prerequisites must only reference ids you defined earlier in the list.\n\n"
        + json.dumps(candidates))
    topics, seen = [], set()
    for t in out["topics"]:
        t["prerequisites"] = [p for p in t.get("prerequisites", []) if p in seen]  # keeps it acyclic
        seen.add(t["id"])
        topics.append(t)
    json.dump({"topics": topics}, open(TOPICS_FILE, "w", encoding="utf-8"), indent=2)
    return topics


def tag_chunks(col, topics):
    ids_ok = {t["id"]: t["name"] for t in topics}
    catalog = [{"id": t["id"], "name": t["name"], "concepts": t["concepts"]} for t in topics]
    data = col.get(include=["documents", "metadatas"])
    ids, docs, metas = data["ids"], data["documents"], data["metadatas"]
    tagged = 0
    for i in range(0, len(ids), TAG_BATCH):
        b_ids, b_docs, b_metas = ids[i:i + TAG_BATCH], docs[i:i + TAG_BATCH], metas[i:i + TAG_BATCH]
        excerpts = "\n".join(f"[{cid}] {short(d, TAG_WORDS)}" for cid, d in zip(b_ids, b_docs))
        out = llm_json(
            "Tag each excerpt with the single best topic id from this list and 1 to 4 concepts it covers "
            "(prefer the listed concepts). If nothing fits, use topic_id \"none\".\n"
            f"TOPICS: {json.dumps(catalog)}\n\nEXCERPTS:\n{excerpts}\n\n"
            'Return JSON: {"tags":[{"id": excerpt id, "topic_id": str, "concepts": [str]}]}')
        by_id = {t["id"]: t for t in out.get("tags", [])}
        new_metas = []
        for cid, meta in zip(b_ids, b_metas):
            tag = by_id.get(cid, {})
            tid = tag.get("topic_id") if tag.get("topic_id") in ids_ok else "none"
            new_metas.append({**meta, "topic": tid, "topic_name": ids_ok.get(tid, "none"),
                              "concepts": ", ".join(tag.get("concepts", []))})
            tagged += tid != "none"
        col.update(ids=b_ids, metadatas=new_metas)
        print(f"  tagged {min(i + TAG_BATCH, len(ids))}/{len(ids)}")
    print(f"Done: {tagged}/{len(ids)} chunks got a topic.")


def main():
    col = chromadb.PersistentClient(path="chroma_db").get_collection("course")
    if os.path.exists(TOPICS_FILE):
        topics = json.load(open(TOPICS_FILE, encoding="utf-8"))["topics"]
        print(f"Using existing {TOPICS_FILE}")
    else:
        print("Building outline...")
        topics = build_outline(col.get(include=["documents"])["documents"])
    for t in topics:
        print(f"- {t['id']}: {t['name']}  (needs: {', '.join(t['prerequisites']) or 'nothing'})")
    input(f"\nRead {TOPICS_FILE}, edit it if anything is wrong, save, then press Enter to start tagging...")
    topics = json.load(open(TOPICS_FILE, encoding="utf-8"))["topics"]
    tag_chunks(col, topics)


if __name__ == "__main__":
    main()