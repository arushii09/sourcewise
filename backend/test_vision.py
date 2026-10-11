"""Test that the vision model can read a slide image.
 project root:  python backend\\test_vision.py
"""
import base64
import os

from dotenv import load_dotenv
from groq import Groq

load_dotenv()
MODEL = os.getenv("MODEL_VISION", "qwen/qwen3.8-27b")
SLIDE = "data/slides_png/slide_33.png"   

img = base64.b64encode(open(SLIDE, "rb").read()).decode()
r = Groq(api_key=os.getenv("GROQ_API_KEY")).chat.completions.create(
    model=MODEL,
    messages=[{"role": "user", "content": [
        {"type": "text", "text": "Describe this lecture slide in 2 sentences, including any code or diagram."},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img}"}},
    ]}],
)
print(r.choices[0].message.content)