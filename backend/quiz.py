"""Quiz generation with cross-model verification, dedupe, grading, reports and learner endpoints.

Included by main.py with  app.include_router(router).  Endpoints:
  POST   /quiz/start               create a quiz (or a one-question-per-topic diagnostic) for a student
  POST   /quiz/answer              grade one answer, update mastery, return cited feedback
  GET    /quiz/report/{session}    post-quiz report: weak topics, likely misconceptions
  GET    /quiz/stats               verification acceptance rates from the generation log
  GET    /learner/{student}        mastery per topic, recommendation, history
  DELETE /learner/{student}        reset a student (demo / simulation)
"""
import json
import os
import random
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import chromadb
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from groq import APIStatusError, Groq, RateLimitError
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

from backend import courses, learner

load_dotenv()
MODEL = os.getenv("MODEL_MAIN")
VERIFY_MODEL = os.getenv("MODEL_VERIFY") or MODEL
VIDEO_ID = os.getenv("VIDEO_ID")
COURSE_NAME = os.getenv("COURSE_NAME", "this course")
DEDUPE_SIM = float(os.getenv("DEDUPE_SIM", "0.82"))   # reject a question this similar to one already asked
MAX_TRIES = 4
EXCERPT_WORDS = 250
WORKERS = 3
# Reject questions that refer to the source text itself, and skip textbook exercise sections.
BAD_PHRASE = re.compile(r"\b(excerpt|passage|according to the (text|book|slide|lecture|material)|in the text|the text above|this slide)\b", re.I)
EXERCISE = re.compile(r"\bExercise\s+\d", re.I)

embedder = SentenceTransformer("BAAI/bge-small-en-v1.5")
col = chromadb.PersistentClient(path="chroma_db").get_collection("course")
llm = Groq(api_key=os.getenv("GROQ_API_KEY"))
router = APIRouter()
save_lock = threading.Lock()
_session_lock = threading.Lock()
_session_used = {}      # session id -> chunk ids already reserved by parallel workers
_verify_state = {"model": VERIFY_MODEL}


# ---------------------------------------------------------------- helpers
def _retry_seconds(msg):
    """Parse 'try again in 1h2m3.5s' style hints from a Groq rate-limit message."""
    m = re.search(r"try again in\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?", msg)
    if not m or not any(m.groups()):
        return None
    h, mi, sec = (float(x) if x else 0.0 for x in m.groups())
    return h * 3600 + mi * 60 + sec


def call_json(model, prompt, temperature=0.0):
    for _ in range(5):
        try:
            r = llm.chat.completions.create(
                model=model, temperature=temperature, response_format={"type": "json_object"},
                messages=[{"role": "system", "content": "You return only valid JSON."},
                          {"role": "user", "content": prompt}])
            return json.loads(r.choices[0].message.content)
        except RateLimitError as e:
            msg = str(e)
            wait = _retry_seconds(msg)
            if wait is not None and wait > 180:       # a daily/hourly cap: waiting here will not help
                raise RuntimeError(f"Groq rate limit on {model}, retry in {wait / 60:.0f} min. {msg[:260]}")
            print(f"[quiz] rate limited on {model}; waiting {min(wait or 15, 60):.0f}s")
            time.sleep(min((wait or 15) + 1, 61))
    raise RuntimeError(f"Rate limited too many times on {model}")


def verify_json(prompt):
    """Run the verifier model; fall back to the main model if the verifier isn't available on this key."""
    model = _verify_state["model"]
    try:
        return call_json(model, prompt), model
    except APIStatusError:
        if model != MODEL:
            print(f"[quiz] verifier {model} unavailable, falling back to {MODEL}")
            _verify_state["model"] = MODEL
            return call_json(MODEL, prompt), MODEL
        raise


def to_number(x):
    try:
        return float(str(x).replace(",", "").strip())
    except ValueError:
        return None


def to_int(x):
    try:
        return int(str(x).strip())
    except ValueError:
        return None


def close(a, b):
    return abs(a - b) <= max(1e-6, 1e-3 * abs(b))


def embed(text):
    return embedder.encode([text], normalize_embeddings=True)[0].tolist()


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def source_url(src_type, n):
    if src_type == "video":
        return f"https://www.youtube.com/embed/{VIDEO_ID}?start={n}&autoplay=1"
    if src_type == "slide":
        return f"/media/slide/{n}"
    return f"/media/book/{n}"


def difficulty_for(p):
    return "easy" if p < 0.4 else "medium" if p < 0.7 else "hard"


# ---------------------------------------------------------------- generation
def used_chunk_ids(student):
    with learner.db() as c:
        return {r["chunk_id"] for r in c.execute("SELECT chunk_id FROM questions WHERE student=?", (student,))}


def pick_chunks(topic_id, exclude, session, course=None):
    got = col.get(where={"topic": topic_id}, include=["documents", "metadatas"])
    items = [(i, d, m) for i, d, m in zip(got["ids"], got["documents"], got["metadatas"]) if len(d.split()) >= 25]
    if course and course != "all":
        items = [x for x in items if (x[2].get("course_id") or "default") == course]
    items = [x for x in items if not EXERCISE.search(x[1])] or items
    if not items:
        return None
    with _session_lock:                       # choose and reserve atomically across parallel workers
        taken = _session_used.setdefault(session, set())
        fresh = ([x for x in items if x[0] not in exclude and x[0] not in taken]
                 or [x for x in items if x[0] not in taken] or items)
        main = random.choice(fresh)
        taken.add(main[0])
    others = [x for x in items if x[0] != main[0]]
    return [main] + random.sample(others, min(1, len(others)))


def excerpts_text(chunks):
    return "\n\n".join(f"[{i}] ({m['location']}, {m['source_type']}) " + " ".join(d.split()[:EXCERPT_WORDS])
                       for i, (_, d, m) in enumerate(chunks, start=1))


RULES = ("Use ONLY the excerpts below. The question must be answerable from them alone and must test "
         "understanding, not trivia such as slide numbers. Do not mention 'the excerpt', 'the slide' or "
         "'the lecture' in the question text. Test a concept, a reasoning step or a computed value; never ask how "
         "many items a list, section or example contains, and never ask about headings or document structure. ")


def gen_prompt(qtype, topic_name, difficulty, chunks):
    head = (f"You write exam questions for the course unit: {COURSE_NAME}. Topic: {topic_name}. "
            f"Difficulty: {difficulty}. {RULES}")
    if qtype == "mcq":
        spec = ('Write ONE multiple-choice question with exactly 4 distinct options and exactly one correct option. '
                'Each wrong option must be plausible and reflect a specific common misconception. '
                'Return JSON: {"question": str, "options": [4 distinct strings], '
                '"correct_option": "the exact text of the correct option, copied from options", '
                '"explanation": str (1-2 sentences on why the correct option is right), '
                '"wrong_option_misconceptions": [{"option": "exact text of one wrong option", '
                '"misconception": str}], "source_excerpt": number of the excerpt the question is based on}')
    elif qtype == "short":
        spec = ('Write ONE short-answer question that can be answered in 1-2 sentences. '
                'Return JSON: {"question": str, "answer": str (model answer), "key_points": [2-3 str], '
                '"explanation": str, "source_excerpt": number of the excerpt the question is based on}')
    else:
        spec = ('Write ONE numerical question whose answer is a single number that follows from the excerpts '
                '(a value the shown code would compute, a number of calls or steps, or a specific quantity the material '
                'states). It must need a small calculation or a specific stated value, not a count of list items. '
                'Return JSON: {"question": str, "answer": number, "explanation": str, '
                '"source_excerpt": number of the excerpt the question is based on}')
    return head + spec + "\n\nEXCERPTS:\n" + excerpts_text(chunks)


def generate(qtype, topic_name, difficulty, chunks):
    d = call_json(MODEL, gen_prompt(qtype, topic_name, difficulty, chunks), temperature=0.7)
    q = str(d.get("question", "")).strip()
    if len(q) < 15:
        raise ValueError("no question text")
    if BAD_PHRASE.search(q):
        raise ValueError("question refers to the source text")
    src = to_int(d.get("source_excerpt"))
    src = src if src and 1 <= src <= len(chunks) else 1
    out = {"type": qtype, "question": q, "explanation": str(d.get("explanation", "")).strip(),
           "source_index": src - 1}
    if qtype == "mcq":
        opts = [str(o.get("text", o) if isinstance(o, dict) else o).strip() for o in d.get("options", [])]
        if len(opts) != 4 or len(set(opts)) != 4:
            raise ValueError(f"bad multiple-choice structure: {len(opts)} options, {len(set(opts))} distinct")
        correct = str(d.get("correct_option", "")).strip()
        ai = opts.index(correct) if correct in opts else None
        if ai is None:                                   # fall back to an index, a letter, or option text
            raw = d.get("answer_index", d.get("answer"))
            ai = to_int(raw)
            if ai is None and isinstance(raw, str):
                r = raw.strip()
                if len(r) == 1 and r.upper() in "ABCD":
                    ai = "ABCD".index(r.upper())
                elif r in opts:
                    ai = opts.index(r)
        if ai is None or not 0 <= ai <= 3:
            raise ValueError(f"bad multiple-choice structure: correct answer not identifiable ({correct[:40]!r})")
        mis_map = {}
        for m in d.get("wrong_option_misconceptions", []) if isinstance(d.get("wrong_option_misconceptions"), list) else []:
            if isinstance(m, dict):
                mis_map[str(m.get("option", "")).strip()] = str(m.get("misconception", "")).strip()
        mis = [mis_map.get(o, "") if i != ai else "" for i, o in enumerate(opts)]
        order = list(range(4))
        random.shuffle(order)                       # remove the model's position bias
        out["options"] = [opts[i] for i in order]
        out["answer_index"] = order.index(ai)
        out["option_misconceptions"] = [mis[i] for i in order]
    elif qtype == "short":
        out["answer"] = str(d.get("answer", "")).strip()
        out["key_points"] = [str(k) for k in d.get("key_points", [])][:3]
        if not out["answer"]:
            raise ValueError("no reference answer")
    else:
        out["answer"] = to_number(d.get("answer"))
        if out["answer"] is None:
            raise ValueError("no numeric answer")
    return out


def verify(draft, chunks):
    """Cross-model check: a second model answers WITHOUT seeing the key; keep the question only if it agrees."""
    base = ("Answer this question using ONLY the excerpts. Be exact.\n\n"
            f"EXCERPTS:\n{excerpts_text(chunks)}\n\nQUESTION: {draft['question']}\n")
    if draft["type"] == "mcq":
        opts = "\n".join(f"{i}: {o}" for i, o in enumerate(draft["options"]))
        out, who = verify_json(base + f"OPTIONS:\n{opts}\n" 'Return JSON: {"answer_index": 0-3}')
        return to_int(out.get("answer_index")) == draft["answer_index"], who
    if draft["type"] == "numerical":
        out, who = verify_json(base + 'Return JSON: {"answer": number}')
        v = to_number(out.get("answer"))
        return v is not None and close(v, draft["answer"]), who
    out, who = verify_json(base + 'Return JSON: {"answer": str (1-2 sentences)}')
    judge, _ = verify_json(
        f"Question: {draft['question']}\nAnswer A: {draft['answer']}\nAnswer B: {out.get('answer', '')}\n"
        'Do A and B agree in substance? Return JSON: {"agree": true or false}')
    return bool(judge.get("agree")), who


def save_if_new(row, emb):
    with save_lock, learner.db() as c:
        for r in c.execute("SELECT embedding FROM questions WHERE student=?", (row["student"],)):
            if dot(emb, json.loads(r["embedding"])) > DEDUPE_SIM:
                return False
        c.execute("INSERT INTO questions VALUES (:id,:student,:session,:topic,:qtype,:difficulty,:chunk_id,"
                  ":payload,:embedding,:src_type,:src_location,:src_num,:verified,:verified_by,:ts)",
                  {**row, "embedding": json.dumps(emb)})
    return True


def make_question(student, session, topic_id, qtype, difficulty, course=None):
    names = {t["id"]: t["name"] for t in learner.load_topics()}
    exclude = used_chunk_ids(student)
    for _ in range(MAX_TRIES):
        chunks = pick_chunks(topic_id, exclude, session, course=course)
        if not chunks:
            return None
        try:
            draft = generate(qtype, names[topic_id], difficulty, chunks)
            ok, who = verify(draft, chunks)
        except Exception as e:  # bad JSON, rate limit, network
            print(f"[quiz] generation error: {e}")
            learner.log_gen(qtype, "error")
            exclude.add(chunks[0][0])
            continue
        if not ok:
            learner.log_gen(qtype, "rejected_verification")
            exclude.add(chunks[0][0])
            continue
        src_id, src_text, src_meta = chunks[draft.pop("source_index")]
        draft["source_snippet"] = " ".join(src_text.split()[:40])
        qid = uuid.uuid4().hex[:12]
        row = {"id": qid, "student": student, "session": session, "topic": topic_id, "qtype": qtype,
               "difficulty": difficulty, "chunk_id": src_id, "payload": json.dumps(draft),
               "src_type": src_meta["source_type"], "src_location": src_meta["location"],
               "src_num": src_meta["loc_num"], "verified": 1, "verified_by": who, "ts": time.time()}
        if not save_if_new(row, embed(draft["question"])):
            learner.log_gen(qtype, "rejected_duplicate")
            exclude.add(chunks[0][0])
            continue
        learner.log_gen(qtype, "accepted")
        out = {"id": qid, "type": qtype, "topic": topic_id, "topic_name": names[topic_id],
               "difficulty": difficulty, "question": draft["question"]}
        if qtype == "mcq":
            out["options"] = draft["options"]
        return out
    if qtype != "mcq":                              # e.g. no numeric question fits this topic
        return make_question(student, session, topic_id, "mcq", difficulty, course=course)
    return None


# ---------------------------------------------------------------- endpoints
class StartIn(BaseModel):
    student: str
    topics: list[str] | None = None
    n: int = 5
    types: list[str] = ["mcq", "short", "numerical"]
    diagnostic: bool = False
    course: str | None = None


@router.post("/quiz/start")
def quiz_start(body: StartIn):
    student = body.student.strip()
    if not student:
        raise HTTPException(400, "student is required")
    learner.ensure_student(student)
    topics = {t["id"]: t for t in learner.load_topics()}
    scope = [t for t in (body.topics or list(topics)) if t in topics]
    if not scope:
        raise HTTPException(400, "No valid topics selected")
    mastery = {m["topic"]: m["p"] for m in learner.get_mastery(student)}
    types = [t for t in body.types if t in ("mcq", "short", "numerical")] or ["mcq"]
    if body.diagnostic:
        plan = [(t, "mcq", "medium") for t in scope]          # one question per topic seeds mastery
    else:
        n = max(1, min(body.n, 10))
        plan = []
        for i in range(n):
            t = random.choices(scope, weights=[1.05 - mastery.get(x, 0.3) for x in scope])[0]  # favour weak topics
            plan.append((t, types[i % len(types)], difficulty_for(mastery.get(t, 0.3))))
    session = uuid.uuid4().hex[:10]
    course_scope = body.course if body.course and body.course != "all" else None
    with ThreadPoolExecutor(WORKERS) as ex:
        results = list(ex.map(lambda p: make_question(student, session, *p, course=course_scope), plan))
    questions = [q for q in results if q]
    if not questions:
        c_name = courses.get_course_name(course_scope) if course_scope else "this course"
        raise HTTPException(400, f"No questions could be generated from {c_name}. Please check that materials are indexed for this course, or select All Courses.")
    return {"session": session, "requested": len(plan), "generated": len(questions),
            "diagnostic": body.diagnostic, "questions": questions, "course": course_scope}


class AnswerIn(BaseModel):
    student: str
    question_id: str
    answer: str          # option index (as text) for multiple choice, a number, or free text


def _citation(q, p, name):
    return {"n": 1, "source_type": q["src_type"], "location": q["src_location"], "loc_num": q["src_num"],
            "topic": name, "snippet": p.get("source_snippet", ""), "url": source_url(q["src_type"], q["src_num"])}


@router.post("/quiz/answer")
def quiz_answer(body: AnswerIn):
    with learner.db() as c:
        q = c.execute("SELECT * FROM questions WHERE id=? AND student=?", (body.question_id, body.student)).fetchone()
        done = c.execute("SELECT 1 FROM attempts WHERE question_id=?", (body.question_id,)).fetchone()
    if not q:
        raise HTTPException(404, "Unknown question")
    if done:
        raise HTTPException(409, "Already answered")
    p = json.loads(q["payload"])
    names = {t["id"]: t["name"] for t in learner.load_topics()}
    misconception, extra, given = "", "", body.answer

    if p["type"] == "mcq":
        idx = to_int(body.answer)
        if idx is None or not 0 <= idx < len(p["options"]):
            raise HTTPException(400, "Choose one of the options")
        correct = idx == p["answer_index"]
        correct_text, given = p["options"][p["answer_index"]], p["options"][idx]
        if not correct:
            misconception = p["option_misconceptions"][idx]
    elif p["type"] == "numerical":
        v = to_number(body.answer)
        if v is None:
            raise HTTPException(400, "Enter a number")
        correct = close(v, p["answer"])
        correct_text = f"{p['answer']:g}"
    else:
        judged = call_json(MODEL, (
            f"Grade a student's short answer.\nQuestion: {p['question']}\nReference answer: {p['answer']}\n"
            f"Key points: {json.dumps(p['key_points'])}\nStudent answer: {body.answer}\n"
            'Return JSON: {"verdict": "correct" or "partial" or "incorrect", "feedback": str (1-2 sentences '
            'addressed to the student), "misconception": str (the likely misunderstanding, "" if correct)}'))
        correct = str(judged.get("verdict", "")).lower() == "correct"
        correct_text = p["answer"]
        extra = str(judged.get("feedback", "")).strip()
        if not correct:
            misconception = str(judged.get("misconception", "")).strip()

    before, after = learner.record_answer(body.student, q["topic"], correct, p["type"], q["difficulty"])
    with learner.db() as c:
        c.execute("INSERT INTO attempts(student, session, question_id, topic, qtype, correct, given, "
                  "misconception, p_before, p_after, ts) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                  (body.student, q["session"], q["id"], q["topic"], p["type"], int(correct), str(given),
                   misconception, before, after, time.time()))
    topic_name = names.get(q["topic"], q["topic"])
    return {"correct": correct, "correct_answer": correct_text,
            "explanation": f"{p['explanation']} {extra}".strip(),
            "misconception": misconception or None,
            "mastery": {"topic": q["topic"], "topic_name": topic_name, "before": before, "after": after},
            "citation": _citation(q, p, topic_name)}


@router.get("/quiz/report/{session}")
def quiz_report(session: str):
    with learner.db() as c:
        rows = c.execute(
            "SELECT a.*, q.payload, q.src_type, q.src_location, q.src_num FROM attempts a "
            "JOIN questions q ON q.id = a.question_id WHERE a.session=? ORDER BY a.ts", (session,)).fetchall()
    if not rows:
        raise HTTPException(404, "No answers recorded for this session yet")
    student = rows[0]["student"]
    names = {t["id"]: t["name"] for t in learner.load_topics()}
    mastery = {m["topic"]: m["p"] for m in learner.get_mastery(student)}
    per, misc = {}, []
    for r in rows:
        s = per.setdefault(r["topic"], {"topic": r["topic"], "name": names.get(r["topic"], r["topic"]),
                                        "correct": 0, "total": 0})
        s["total"] += 1
        s["correct"] += r["correct"]
        if not r["correct"] and r["misconception"]:
            p = json.loads(r["payload"])
            misc.append({"topic_name": s["name"], "misconception": r["misconception"], "question": p["question"],
                         "citation": _citation(r, p, s["name"])})
    topics_out = []
    for s in per.values():
        s["accuracy"] = s["correct"] / s["total"]
        s["mastery"] = mastery.get(s["topic"])
        s["weak"] = s["accuracy"] < 0.6 or (s["mastery"] is not None and s["mastery"] < learner.WEAK)
        topics_out.append(s)
    topics_out.sort(key=lambda s: s["mastery"] if s["mastery"] is not None else 0)
    return {"session": session, "student": student, "score": sum(r["correct"] for r in rows), "total": len(rows),
            "topics": topics_out, "weak_topics": [s for s in topics_out if s["weak"]],
            "misconceptions": misc, "recommended": learner.recommend(student)}


@router.get("/quiz/stats")
def quiz_stats():
    with learner.db() as c:
        rows = c.execute("SELECT qtype, outcome, COUNT(*) AS n FROM gen_log GROUP BY qtype, outcome").fetchall()
    by_type = {}
    for r in rows:
        by_type.setdefault(r["qtype"], {})[r["outcome"]] = r["n"]
    total = sum(r["n"] for r in rows)
    accepted = sum(r["n"] for r in rows if r["outcome"] == "accepted")
    return {"by_type": by_type, "accepted": accepted, "generation_attempts": total,
            "acceptance_rate": accepted / total if total else None}


@router.get("/learner/{student}")
def learner_state(student: str):
    return {"student": student, "topics": learner.get_mastery(student),
            "recommended": learner.recommend(student), "history": learner.history(student)}


@router.delete("/learner/{student}")
def learner_reset(student: str):
    learner.reset_student(student)
    return {"ok": True}