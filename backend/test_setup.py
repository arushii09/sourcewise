import os
from dotenv import load_dotenv
from groq import Groq
from sentence_transformers import SentenceTransformer
import chromadb

load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))
r = client.chat.completions.create(
    model=os.getenv("MODEL_MAIN"),
    messages=[{"role": "user", "content": 'Reply with JSON: {"ok": true}'}],
    response_format={"type": "json_object"},
)
print("Groq:", r.choices[0].message.content)

model = SentenceTransformer("BAAI/bge-small-en-v1.5")
print("Embedding size:", len(model.encode("what is recursion")))

db = chromadb.PersistentClient(path="chroma_db")
print("Chroma ready:", db.get_or_create_collection("test").name)