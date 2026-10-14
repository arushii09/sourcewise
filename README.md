# SourceWise

> A source-cited AI study companion. It turns a lecture video, a textbook and slides into one knowledge base, answers only from that material with clickable citations, and tutors adaptively using a per-topic learner model.
**Personalized Tutoring & Adaptive Learning**


## What it does

| Track D requirement | How SourceWise covers it |
| --- | --- |
| Multimodal knowledge base | Ingests lecture-video captions (timestamps), textbook PDF (pages) and slides (slide numbers). A vision model describes figures. An LLM builds a topic / concept / prerequisite graph and tags every chunk. Every chunk keeps its origin. New PDFs and YouTube links can be added through the upload API without restarting the server. |
| Source grounding | The tutor answers only from retrieved excerpts, with numbered citations that open the exact slide image, book page, or video at the timestamp. Questions the material does not cover are declined. |
| Adaptive assessment | Multiple-choice, short-answer and numerical questions on a chosen scope, tagged with topic, source location and difficulty. Each question is verified by a second model that answers it without seeing the key; near-duplicates are rejected. Cited feedback, likely misconceptions, and a post-quiz report. |
| Learner model | Bayesian knowledge tracing per topic, updated after every graded answer (and weakly after tutor questions). A diagnostic quiz handles new students. Recommendations respect topic prerequisites. |
| System evaluation | RAGAS (faithfulness, answer relevancy, context precision, context recall) plus retrieval, citation and refusal accuracy on a hand-built test set; simulated students for personalization (mastery gain, estimate error, repetition rate). |

Pages: **Tutor chat** (`/`), **Quiz** (`/quiz`), **Dashboard** (`/dashboard`), **Sources** (`/sources`) **[CONFIRM: keep this only if the Sources page works end to end]**.

## Quick demo flow

1. Open **Tutor chat**. The header shows which course the answers are grounded in.
2. Ask a question covered by the indexed material.
3. Open a citation to inspect the exact slide, book page, or video moment behind the answer.
4. Ask an off-topic question to show the refusal.
5. Open **Quiz**, answer a few questions, and read the report with feedback and likely misconceptions.
6. Open **Dashboard** to see per-topic mastery, the recommended next topic, and progress over time.
7. **[CONFIRM: only if the Sources page works]** Open **Sources**, upload a PDF, watch it move through extracting, embedding and indexing, then ask a question about it in Tutor chat.

## Architecture

```
 lecture video        textbook PDF         slides PDF
 (YouTube captions)   (PyMuPDF, pages)     (PyMuPDF, slide images)
        \                  |                     /
         \                 |        vision model describes figures
          v                v                    v
        chunks with origin: page | slide | start-second
                           |
        LLM: topics, concepts, prerequisites (topics.json) + per-chunk tags
                           |
        local embeddings (bge-small) --> Chroma vector store  <-- upload API (PDF / YouTube, adds chunks live)
             |                               |                        |
             v                               v                        v
     Tutor chat (FastAPI)         Quiz service (FastAPI)       Learner model (SQLite)
     retrieve -> gate -> answer   generate -> verify (2nd      BKT mastery per topic,
     with [n] citations           model) -> dedupe -> grade    recommendations
             \_______________________________|_______________________/
                                             v
                       Next.js UI: chat, quiz, dashboard, citation viewer
```

### Grounding method

1. Embed the question locally (BAAI/bge-small-en-v1.5), retrieve the top 6 chunks from Chroma (cosine distance).
2. **Gate 1:** if the best distance is above `GATE_DIST` (calibrated with `calibrate_gate.py`; 0.27 for the demo course), decline.
3. **Gate 2:** the generator must return `answerable: true` and cite excerpt numbers it used; otherwise decline.
4. Citations carry the chunk's stored origin, so a click opens the exact slide image, book page image, or the video embed at that second.
5. Outside knowledge is never mixed in: a declined question says the material does not cover it.

### Assessment pipeline

- Questions are written from tagged chunks of the selected topics (weighted toward weak topics; difficulty follows mastery). Textbook exercise sections are skipped, and questions that refer to "the excerpt" or ask for list counts are rejected.
- **Verification:** a different-family model (`qwen/qwen3.8-27b`) answers the question from the same excerpts without seeing the key; the question is kept only if it agrees (numeric tolerance for numbers; a judge call for short answers).
- **No repeats:** source chunks are reserved per quiz session, and questions whose embedding is within cosine 0.82 of any earlier question for that student are rejected.
- Feedback cites the source chunk. A wrong multiple-choice answer shows the misconception that option encodes; short answers are graded by a judge that also names the likely misconception.

### Learner model

Bayesian knowledge tracing per student and topic. After an answer:

```
P(L|correct) = P(L)(1-s) / [P(L)(1-s) + (1-P(L))g]
P(L|wrong)   = P(L)s / [P(L)s + (1-P(L))(1-g)]
P(L_next)    = P(L|obs) + (1 - P(L|obs)) * t
```

Prior 0.3, learn rate t = 0.15, slip s = 0.10, guess g = 0.25 for multiple choice and 0.05 for short/numerical, adjusted by difficulty (easy questions are easier to guess, hard ones are slipped more). Asking the tutor about a topic is treated as weak evidence of a gap (a 0.02 nudge down) and is documented as such, not as measured knowledge. The recommended next topic is the weakest one, unless one of its prerequisites is also weak, in which case the prerequisite comes first.

### Adding sources without restarting (upload API)

`POST /sources/upload` accepts a PDF (as `slides` or `book`) and `POST /sources/youtube` accepts a YouTube link. Each starts a background job that extracts text with its origin (slide, page or timestamp), embeds it locally, and adds it to the same Chroma collection. Progress is available at `GET /sources/jobs/{job_id}` (extracting, embedding, indexing, done). Uploaded PDFs are saved under `data/uploads/` and their pages are served as images at `/media/doc/{doc_id}/{n}`, so citations to uploaded material open the exact page just like the demo course. Re-uploading the same file is detected and skipped. See "Known limitations" for what uploaded material does not get yet.

## Tech stack

Python 3.11, FastAPI, Uvicorn, Pydantic, python-multipart, ChromaDB, sentence-transformers (BAAI/bge-small-en-v1.5), PyMuPDF, youtube-transcript-api, SQLite, Groq API (generator `openai/gpt-oss-120b`; verifier, judge and vision `qwen/qwen3.8-27b`), RAGAS, Next.js (App Router) with TypeScript and Tailwind CSS.

## Repository layout

```
backend/
  ingest.py            read slides, book pages, video captions -> chunks -> Chroma (video_chunks accepts any video ID)
  upload.py            upload API: add PDFs / YouTube links to the live collection, job status, source list, uploaded page images
  caption_slides.py    describe slide figures with a vision model -> searchable chunks
  tag_topics.py        build topics.json (topics, concepts, prerequisites) and tag chunks
  main.py              FastAPI app: /chat, media endpoints, includes the quiz and upload routers
  quiz.py              quiz generation, verification, dedupe, grading, report, learner endpoints
  learner.py           SQLite store and Bayesian knowledge tracing
  calibrate_gate.py    pick the retrieval gate distance
  eval_rag.py          RAGAS + retrieval / citation / refusal evaluation
  simulate_students.py simulated-student evaluation of personalization
  search.py, test_models.py, test_setup.py, test_vision.py   small helper scripts
frontend/app/          Next.js pages: chat, quiz, dashboard, sources, shared components
eval/test_set.json     30 in-scope questions (hand-verified gold sources) + off-material questions
eval/results/          evaluation outputs (rag_eval.md/json, simulation.json, caches)
topics.json            topic graph for the demo course
data/uploads/          PDFs added through the upload API (created at runtime)
```

## Setup

### Prerequisites

- Python 3.11+, Node.js 20+, a free [Groq](https://console.groq.com) API key.
- The demo course material (not redistributed here):
  - MIT OCW 6.0001 (Fall 2016) Lecture 6 slides PDF and the lecture video ID (https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/).
  - *Think Python*, 2nd edition (Allen Downey), as a PDF.
  Put the PDFs in `data/`.

### Install

```bash
python -m venv .venv
# Windows PowerShell:  .venv\Scripts\Activate.ps1      macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cd frontend && npm install && cd ..
```

`requirements.txt` must include `python-multipart` (FastAPI needs it for file uploads).

### Configure

Create `.env` in the project root (never commit it):

```
GROQ_API_KEY=your_key
MODEL_MAIN=openai/gpt-oss-120b
MODEL_VERIFY=qwen/qwen3.8-27b
MODEL_JUDGE=qwen/qwen3.8-27b
MODEL_VISION=qwen/qwen3.8-27b
VIDEO_ID=WPSeyjX1-4s
BOOK_PDF=data/think_python.pdf
COURSE_NAME=MIT 6.0001 Lecture 6: Recursion and Dictionaries
GATE_DIST=0.27
```

Model availability differs per Groq account; `python backend/test_models.py` shows which models your key can call. Groq's free tier allows about 8,000 tokens per minute per model, so generation and evaluation are slow and rate-limited; the scripts wait and retry.

In `backend/ingest.py`, set `SLIDES_PDF`, `BOOK_PDF` and `BOOK_PAGES` (PDF page ranges of the chapters to use; the evaluation gold uses PDF pages 65-67 and 125-132).

### Build the knowledge base (run from the project root)

```bash
python backend/ingest.py          # slides, book pages and video captions -> Chroma
python backend/caption_slides.py  # figure descriptions from slide images
python backend/tag_topics.py      # builds topics.json; review it, press Enter to tag chunks
python backend/calibrate_gate.py  # optional: choose GATE_DIST
```

`ingest.py` rebuilds the collection, so re-run `caption_slides.py` and `tag_topics.py` afterwards (both cache their model calls). It also removes anything added through the upload API.

### Run

```bash
uvicorn backend.main:app --port 8000      # API, docs at http://localhost:8000/docs
cd frontend && npm run dev                # UI at http://localhost:3000
```

## Evaluation

All evaluation scripts run from the project root and write to `eval/results/`.

```bash
python backend/eval_rag.py --skip-ragas            # retrieval, citation, refusal metrics
pip install ragas "langchain-community<0.4"        # RAGAS 0.4 needs this pin
python backend/eval_rag.py --ragas-limit 15        # adds RAGAS metrics (LLM judge)
python backend/simulate_students.py --synthetic-bank --students 20
```

### Retrieval, citations, refusals (30 in-scope + 10 off-material questions)

| Metric | Result |
| --- | --- |
| Retrieval hit@6 (a gold source is among the retrieved chunks) | 96.7% (MRR 0.762) |
| In-scope questions answered | 100% |
| Answers with at least one correct citation | 93.3% |
| Citation precision (a lower bound: gold lists are not exhaustive) | 56.9% |
| Off-material questions refused | 100% (unrelated and near-topic) |

By question type, hit@6: figure 100%, text 100%, video 100%, slide 91.7%. Failure cases are listed in `eval/results/rag_eval.md`.

### RAGAS (judge: `qwen/qwen3.8-27b`, different from the generator)

**[FILL from eval/results/rag_eval.md: faithfulness, answer relevancy, context precision, context recall, and the number of questions scored. Free-tier rate limits (HTTP 429) interrupted some judge calls, so state how many of the 15 questions were fully scored.]**

### Personalization (simulated students)

**[FILL from eval/results/simulation.json -> table_markdown, and 2-3 sentences interpreting it]**

### Honest limitations of the evaluation

- One course unit and a small test set; gold sources were hand-verified but are not exhaustive.
- The gate distance was calibrated on questions similar to the off-material test questions, so the refusal numbers are optimistic. Add new off-topic questions to re-check.
- The RAGAS judge is an LLM and is noisy on small samples; it was run on a subset because of free-tier rate limits.
- Simulated students learn from practice by construction, which favors targeted practice. The simulation validates the mechanism, not real-world learning. The synthetic question bank uses only topic / type / difficulty metadata, which is all the simulated students read.
- The knowledge-tracing estimate is still optimistic for very weak students (see `simulation.json`, estimate error).

## Known limitations

- Material added through the upload API is searchable in Tutor chat with exact citations right away, but it is not yet topic-tagged, so it does not feed quizzes, the topic graph or the dashboard. Tagging and figure captioning still run through `tag_topics.py` and `caption_slides.py` for the demo course.
- Uploads support text-based PDFs only (no OCR for scanned pages) and YouTube videos that have captions. There is no video-file upload.
- One course unit is indexed for quizzes and the dashboard; prompts use `COURSE_NAME` from `.env` and are not tied to the demo course, but multi-course management is not built.
- Quiz generation is slow on the free tier.
- Some questions generated from slides with sparse text can be shallow.

## Data, licenses and originality

Course materials are not redistributed. MIT OpenCourseWare content is CC BY-NC-SA; *Think Python* 2e is CC BY-NC. All code in this repository was written during the hackathon period **[CONFIRM: no code from earlier projects was reused, or list what was]**. The project was developed with AI coding assistance (Claude); design decisions, evaluation, and testing against the real material were done by the author.

## API summary

`POST /chat` · `POST /quiz/start` · `POST /quiz/answer` · `GET /quiz/report/{session}` · `GET /quiz/stats` · `GET /learner/{student}` · `DELETE /learner/{student}` · `POST /sources/upload` · `POST /sources/youtube` · `GET /sources/jobs/{job_id}` · `GET /sources` · `GET /media/slide/{n}` · `GET /media/book/{n}` · `GET /media/doc/{doc_id}/{n}` · `GET /health`
