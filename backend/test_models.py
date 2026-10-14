"""Check which Groq models your key can call in JSON mode, and how much quota is left.
Run from the project root:  python backend\\test_models.py
Pick a model different from MODEL_MAIN for MODEL_VERIFY (and optionally MODEL_JUDGE) in .env.
Rate limits on Groq are PER MODEL, so spreading generator / verifier / judge over different models spreads the quota.
"""
import json
import os
import time

from dotenv import load_dotenv
from groq import Groq

load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))
CANDIDATES = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b",
              "llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
PROMPT = 'What is 17 + 25? Return JSON: {"answer": number}'
HEADERS = ["x-ratelimit-limit-requests", "x-ratelimit-remaining-requests", "x-ratelimit-limit-tokens",
           "x-ratelimit-remaining-tokens", "x-ratelimit-reset-tokens"]

print(f"MODEL_MAIN = {os.getenv('MODEL_MAIN')}   MODEL_VERIFY = {os.getenv('MODEL_VERIFY')}\n")
for m in CANDIDATES:
    t = time.time()
    try:
        raw = client.chat.completions.with_raw_response.create(
            model=m, temperature=0, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": "You return only valid JSON."},
                      {"role": "user", "content": PROMPT}])
        out = json.loads(raw.parse().choices[0].message.content)
        h = {k.replace("x-ratelimit-", ""): raw.headers.get(k) for k in HEADERS if raw.headers.get(k)}
        print(f"OK    {m:26} json ok, correct={float(out.get('answer', -1)) == 42}  ({time.time() - t:.1f}s)")
        if h:
            print(f"      quota: {h}")
    except Exception as e:
        print(f"FAIL  {m:26} {str(e)[:400]}")