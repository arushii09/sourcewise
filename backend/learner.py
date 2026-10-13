"""Learner model: per-topic mastery with Bayesian knowledge tracing (BKT), stored in SQLite.

Mastery P(L) is updated after every graded answer:
    P(L|correct) = P(L)(1-s) / [P(L)(1-s) + (1-P(L))g]
    P(L|wrong)   = P(L)s / [P(L)s + (1-P(L))(1-g)]
    P(L_next)    = P(L|obs) + (1 - P(L|obs)) * t
"""
import json
import os
import sqlite3
import threading
import time
from contextlib import contextmanager

DB_PATH = os.getenv("LEARNER_DB", "learner.db")
TOPICS_FILE = "topics.json"

P_INIT = 0.3        # prior mastery for a new student
P_LEARN = 0.15      # t: chance of learning on each attempt
P_SLIP = 0.10       # s: knows it but answers wrong
GUESS = {"mcq": 0.25, "short": 0.05, "numerical": 0.05}   # g: doesn't know but answers right
CHAT_NUDGE = 0.02   # weak evidence: asking the tutor about a topic nudges mastery down slightly
WEAK = 0.5          # below this a topic counts as weak

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY, created REAL);
CREATE TABLE IF NOT EXISTS mastery(student TEXT, topic TEXT, p REAL, n INTEGER, updated REAL,
                                   PRIMARY KEY(student, topic));
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY AUTOINCREMENT, student TEXT, topic TEXT,
                                   p REAL, source TEXT, ts REAL);
CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY, student TEXT, session TEXT, topic TEXT,
                                     qtype TEXT, difficulty TEXT, chunk_id TEXT, payload TEXT,
                                     embedding TEXT, src_type TEXT, src_location TEXT, src_num INTEGER,
                                     verified INTEGER, verified_by TEXT, ts REAL);
CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY AUTOINCREMENT, student TEXT, session TEXT,
                                    question_id TEXT, topic TEXT, qtype TEXT, correct INTEGER,
                                    given TEXT, misconception TEXT, p_before REAL, p_after REAL, ts REAL);
CREATE TABLE IF NOT EXISTS gen_log(id INTEGER PRIMARY KEY AUTOINCREMENT, qtype TEXT, outcome TEXT, ts REAL);
"""


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init():
    with db() as c:
        c.executescript(SCHEMA)


def load_topics():
    return json.load(open(TOPICS_FILE, encoding="utf-8"))["topics"]


def ensure_student(student):
    now = time.time()
    with db() as c:
        c.execute("INSERT OR IGNORE INTO students VALUES (?, ?)", (student, now))
        for t in load_topics():
            c.execute("INSERT OR IGNORE INTO mastery VALUES (?, ?, ?, 0, ?)", (student, t["id"], P_INIT, now))


def bkt_update(p, correct, guess):
    if correct:
        post = p * (1 - P_SLIP) / (p * (1 - P_SLIP) + (1 - p) * guess)
    else:
        post = p * P_SLIP / (p * P_SLIP + (1 - p) * (1 - guess))
    return post + (1 - post) * P_LEARN


def record_answer(student, topic, correct, qtype):
    """Update mastery after a graded answer. Returns (before, after)."""
    ensure_student(student)
    with _lock, db() as c:
        row = c.execute("SELECT p FROM mastery WHERE student=? AND topic=?", (student, topic)).fetchone()
        before = row["p"] if row else P_INIT
        after = bkt_update(before, bool(correct), GUESS.get(qtype, 0.05))
        now = time.time()
        c.execute("INSERT OR REPLACE INTO mastery VALUES (?, ?, ?, COALESCE((SELECT n FROM mastery "
                  "WHERE student=? AND topic=?), 0) + 1, ?)", (student, topic, after, student, topic, now))
        c.execute("INSERT INTO history(student, topic, p, source, ts) VALUES (?, ?, ?, 'quiz', ?)",
                  (student, topic, after, now))
    return before, after


def nudge_from_chat(student, topic):
    """Tutor questions are weak evidence of a gap: small downward nudge (documented, not 'measured')."""
    ensure_student(student)
    with _lock, db() as c:
        row = c.execute("SELECT p FROM mastery WHERE student=? AND topic=?", (student, topic)).fetchone()
        if not row:
            return
        p = max(0.05, row["p"] - CHAT_NUDGE)
        now = time.time()
        c.execute("UPDATE mastery SET p=?, updated=? WHERE student=? AND topic=?", (p, now, student, topic))
        c.execute("INSERT INTO history(student, topic, p, source, ts) VALUES (?, ?, ?, 'chat', ?)",
                  (student, topic, p, now))


def get_mastery(student):
    ensure_student(student)
    names = {t["id"]: t["name"] for t in load_topics()}
    order = {t["id"]: i for i, t in enumerate(load_topics())}
    with db() as c:
        rows = c.execute("SELECT topic, p, n FROM mastery WHERE student=?", (student,)).fetchall()
    out = [{"topic": r["topic"], "name": names.get(r["topic"], r["topic"]), "p": r["p"], "n": r["n"]}
           for r in rows if r["topic"] in names]
    return sorted(out, key=lambda x: order[x["topic"]])


def history(student):
    with db() as c:
        rows = c.execute("SELECT topic, p, source, ts FROM history WHERE student=? ORDER BY ts", (student,)).fetchall()
    return [dict(r) for r in rows]


def _root_cause(tid, m, by_id):
    seen = set()
    while True:
        seen.add(tid)
        weak = [p for p in by_id[tid]["prerequisites"] if m.get(p, P_INIT) < WEAK and p not in seen]
        if not weak:
            return tid
        tid = min(weak, key=lambda x: m.get(x, P_INIT))


def recommend(student):
    """Weakest topic, unless one of its prerequisites is also weak; then recommend that one first."""
    topics = load_topics()
    by_id = {t["id"]: t for t in topics}
    m = {x["topic"]: x["p"] for x in get_mastery(student)}
    weakest = min(topics, key=lambda t: m.get(t["id"], P_INIT))["id"]
    root = _root_cause(weakest, m, by_id)
    if root != weakest:
        reason = f"Prerequisite of {by_id[weakest]['name']} (mastery {m[root]:.0%})"
    else:
        reason = f"Lowest mastery ({m[root]:.0%})"
    return {"topic": root, "name": by_id[root]["name"], "reason": reason}


def reset_student(student):
    with db() as c:
        for table in ("mastery", "history", "attempts", "questions"):
            c.execute(f"DELETE FROM {table} WHERE student=?", (student,))
        c.execute("DELETE FROM students WHERE id=?", (student,))


def log_gen(qtype, outcome):
    with db() as c:
        c.execute("INSERT INTO gen_log(qtype, outcome, ts) VALUES (?, ?, ?)", (qtype, outcome, time.time()))


init()