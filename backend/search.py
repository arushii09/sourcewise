#python backend\search.py "what is recursion" 
import sys

import chromadb
from sentence_transformers import SentenceTransformer

query = " ".join(sys.argv[1:]) or "what is recursion"
model = SentenceTransformer("BAAI/bge-small-en-v1.5")
col = chromadb.PersistentClient(path="chroma_db").get_collection("course")

res = col.query(query_embeddings=model.encode([query], normalize_embeddings=True).tolist(), n_results=5)
for doc, meta, dist in zip(res["documents"][0], res["metadatas"][0], res["distances"][0]):
    topic = meta.get("topic", "-")
    print(f"[{meta['source_type']} | {meta['location']} | topic {topic} | dist {dist:.2f}] {doc[:140]}...")