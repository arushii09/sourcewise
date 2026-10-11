"""Print the best retrieval distance for in-scope vs off-topic questions.
 from the project root:  python backend\\calibrate_gate.py
Pick GATE_DIST (in .env) between the largest in-scope value and the smallest off-topic value.
Edit the two lists to add your own questions.
"""
import chromadb
from sentence_transformers import SentenceTransformer

IN_SCOPE = [
    "What is a base case in recursion?",
    "How does memoization speed up Fibonacci?",
    "How do I get all the keys of a dictionary?",
    "What is the Towers of Hanoi problem?",
    "Why can't a list be a dictionary key?",
    "How does the call stack work during recursion?",
]
OFF_TOPIC = [
    "What is the capital of France?",
    "How do I train a neural network?",
    "Explain how TCP handshakes work.",
    "What is the best way to cook pasta?",
    "How does inheritance work in Java?",
    "Who won the 2018 football world cup?",
]

model = SentenceTransformer("BAAI/bge-small-en-v1.5")
col = chromadb.PersistentClient(path="chroma_db").get_collection("course")


def best(q):
    r = col.query(query_embeddings=model.encode([q], normalize_embeddings=True).tolist(), n_results=1)
    return r["distances"][0][0]


print("IN SCOPE")
vals_in = [best(q) for q in IN_SCOPE]
for q, d in zip(IN_SCOPE, vals_in):
    print(f"  {d:.3f}  {q}")
print("OFF TOPIC")
vals_off = [best(q) for q in OFF_TOPIC]
for q, d in zip(OFF_TOPIC, vals_off):
    print(f"  {d:.3f}  {q}")
print(f"\nlargest in-scope = {max(vals_in):.3f}, smallest off-topic = {min(vals_off):.3f}")
if max(vals_in) < min(vals_off):
    print(f"Suggested GATE_DIST = {(max(vals_in) + min(vals_off)) / 2:.2f}")
else:
    print("The ranges overlap: distance alone can't separate them. Keep the gate loose and let the model check decide.")