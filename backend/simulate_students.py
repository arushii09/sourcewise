"""Simulated-student evaluation of the learner model and adaptive question selection.

Run from the project root (C:\\sourcewise):

  Step 1, once (calls the LLM, about 10-20 min): build a question bank with the REAL generator,
          so tags, types and difficulties come from the real system:
      python backend\\simulate_students.py --build-bank --per-topic 6
      (no time? use  --synthetic-bank  in step 2 instead; it only needs topic/type/difficulty metadata)

  Step 2 (instant, repeatable, no LLM calls):
      python backend\\simulate_students.py --students 20

Each simulated student has HIDDEN true knowledge per topic and answers from it. Three policies serve
5 sessions of 6 questions to identical students:
  adaptive          the real system's rule: topics weighted by (1.05 - estimated mastery), difficulty by mastery,
                    never repeats a question it already served
  random            random topic and difficulty, still never repeats (isolates the effect of adaptation)
  random_no_memory  random topic, question drawn with replacement (shows what repetition control prevents)
The mastery estimator is the real Bayesian knowledge tracing code from learner.py.

HONEST LIMITS: the hidden students learn from practice (an assumption that favours targeted practice), and
their dynamics differ from the estimator's parameters on purpose but are still BKT-like. This validates the
mechanism, not real-world learning. A finite bank means the seen-filter arms occasionally have to reuse a
question; that is counted and reported separately.
"""
import argparse
import json
import math
import os
import random
import statistics
import sys

sys.path.insert(0, os.getcwd())
from backend import learner  # noqa: E402

OUT_DIR = "eval/results"
BANK_FILE = f"{OUT_DIR}/bank.json"
SESSIONS, PER_SESSION = 5, 6
DIFFS = ["easy", "medium", "hard"]
PROFILES = ["novice", "advanced", "weak_on_two", "uneven"]
POLICIES = ["adaptive", "random", "random_no_memory"]

# Hidden-student dynamics (deliberately different from the estimator's constants)
TRUE_SLIP = 0.08
TRUE_GUESS = {"mcq": 0.20, "short": 0.04, "numerical": 0.04}
TRUE_LEARN = 0.10                       # knowledge gained per attempt, scaled by (1 - k)
LEARN_IF_WRONG = 0.6                    # learning from feedback even when wrong
DIFF_SHIFT = {"easy": 0.15, "medium": 0.0, "hard": -0.15}


# ------------------------------------------------------------------ bank
def build_bank(per_topic):
    """Generate real, verified questions with the production pipeline and save their metadata."""
    from concurrent.futures import ThreadPoolExecutor
    from backend import quiz

    student = "__bank__"
    learner.ensure_student(student)
    topics = learner.load_topics()
    with learner.db() as c:
        rows = c.execute("SELECT topic, COUNT(*) AS n FROM questions WHERE student=? GROUP BY topic", (student,)).fetchall()
    have = {r["topic"]: r["n"] for r in rows}
    types = ["mcq", "mcq", "short", "numerical"]
    plan = []
    for t in topics:
        for i in range(max(0, per_topic - have.get(t["id"], 0))):
            plan.append((t["id"], types[i % len(types)], DIFFS[i % len(DIFFS)]))
    print(f"Generating {len(plan)} questions (this calls the LLM; rate limits may slow it)...")
    with ThreadPoolExecutor(2) as ex:      # gentle on the free-tier rate limits
        list(ex.map(lambda p: quiz.make_question(student, "bank", *p), plan))
    with learner.db() as c:
        rows = c.execute("SELECT id, topic, qtype, difficulty FROM questions WHERE student=?", (student,)).fetchall()
    questions = [dict(r) for r in rows]
    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump({"source": "real generator", "questions": questions}, open(BANK_FILE, "w"), indent=1)
    by_topic = {}
    for q in questions:
        by_topic[q["topic"]] = by_topic.get(q["topic"], 0) + 1
    print(f"Bank saved to {BANK_FILE}: {len(questions)} verified questions. Per topic: {by_topic}")


def load_bank(synthetic, per_topic):
    topics = [t["id"] for t in learner.load_topics()]
    if synthetic:
        types = ["mcq", "mcq", "short", "numerical"]
        qs = [{"id": f"{t}-{i}", "topic": t, "qtype": types[i % 4], "difficulty": DIFFS[i % 3]}
              for t in topics for i in range(per_topic)]
        return "synthetic metadata only", qs
    if not os.path.exists(BANK_FILE):
        raise SystemExit(f"No bank found. Run with --build-bank first, or use --synthetic-bank.")
    data = json.load(open(BANK_FILE))
    return data["source"], data["questions"]


# ------------------------------------------------------------------ simulation
def difficulty_for(p):
    return "easy" if p < 0.4 else "medium" if p < 0.7 else "hard"


def p_correct(k, qtype, diff):
    ke = min(1.0, max(0.0, k + DIFF_SHIFT[diff]))
    return ke * (1 - TRUE_SLIP) + (1 - ke) * TRUE_GUESS.get(qtype, 0.04)


def initial_knowledge(profile, ids, rng):
    n = len(ids)
    if profile == "novice":
        base = [0.10] * n
    elif profile == "advanced":
        base = [0.80] * n
    elif profile == "weak_on_two":
        base = [0.70] * n
        base[-1] = base[-2] = 0.10
    else:  # uneven
        base = [rng.uniform(0.05, 0.85) for _ in range(n)]
    return {t: min(0.95, max(0.02, b + rng.gauss(0, 0.05))) for t, b in zip(ids, base)}


def run_student(policy, k0, bank, rng):
    ids = [t for t in k0 if bank.get(t)]
    k = dict(k0)
    est = {t: learner.P_INIT for t in k}
    seen, served, repeats, reused, session_acc = set(), 0, 0, 0, []
    traj = [statistics.mean(k.values())]
    err = [statistics.mean(abs(est[t] - k[t]) for t in k)]
    for _ in range(SESSIONS):
        correct_in_session = 0
        for _ in range(PER_SESSION):
            if policy == "adaptive":
                t = rng.choices(ids, weights=[1.05 - est[x] for x in ids])[0]
                want = difficulty_for(est[t])
            else:
                t, want = rng.choice(ids), rng.choice(DIFFS)
            pool = bank[t]
            if policy == "random_no_memory":
                q = rng.choice(pool)
            else:
                unseen = [x for x in pool if x["id"] not in seen]
                preferred = [x for x in unseen if x["difficulty"] == want]
                if preferred:
                    q = rng.choice(preferred)
                elif unseen:
                    q = rng.choice(unseen)
                else:
                    q, reused = rng.choice(pool), reused + 1
            served += 1
            repeats += q["id"] in seen
            seen.add(q["id"])
            ok = rng.random() < p_correct(k[t], q["qtype"], q["difficulty"])
            correct_in_session += ok
            g, sl = learner.params(q["qtype"], q["difficulty"])
            est[t] = learner.bkt_update(est[t], ok, g, sl)
            k[t] += (TRUE_LEARN if ok else TRUE_LEARN * LEARN_IF_WRONG) * (1 - k[t])
        session_acc.append(correct_in_session / PER_SESSION)
        traj.append(statistics.mean(k.values()))
        err.append(statistics.mean(abs(est[t] - k[t]) for t in k))
    weak = [t for t in k if k0[t] < 0.4]
    return {
        "true_gain": traj[-1] - traj[0],
        "weak_gain": statistics.mean(k[t] - k0[t] for t in weak) if weak else None,
        "est_gain": statistics.mean(est[t] - learner.P_INIT for t in est),
        "err_start": err[0], "err_end": err[-1],
        "repetition_rate": repeats / served, "reuse_rate": reused / served,
        "acc_first": session_acc[0], "acc_last": session_acc[-1],
        "traj": traj,
    }


def mean_sd(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return None, None
    return statistics.mean(xs), (statistics.stdev(xs) if len(xs) > 1 else 0.0)


def fmt(xs, pct=False, nd=3):
    m, s = mean_sd(xs)
    if m is None:
        return "-"
    return f"{m * 100:.1f}% ± {s * 100:.1f}" if pct else f"{m:.{nd}f} ± {s:.{nd}f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--build-bank", action="store_true")
    ap.add_argument("--per-topic", type=int, default=6)
    ap.add_argument("--synthetic-bank", action="store_true")
    ap.add_argument("--students", type=int, default=20, help="simulated students per profile")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    if args.build_bank:
        build_bank(args.per_topic)
        return

    source, questions = load_bank(args.synthetic_bank, args.per_topic)
    bank = {}
    for q in questions:
        bank.setdefault(q["topic"], []).append(q)
    ids = [t["id"] for t in learner.load_topics()]
    print(f"Bank: {len(questions)} questions ({source}); topics with questions: {len([t for t in ids if bank.get(t)])}/{len(ids)}")

    results = {p: {pol: [] for pol in POLICIES} for p in PROFILES}
    for pi, prof in enumerate(PROFILES):
        for s in range(args.students):
            k0 = initial_knowledge(prof, ids, random.Random(args.seed * 100003 + pi * 1009 + s))
            for poli, pol in enumerate(POLICIES):
                rng = random.Random(args.seed * 7919 + pi * 131 + s * 17 + poli)
                results[prof][pol].append(run_student(pol, k0, bank, rng))

    lines = [f"### Simulated students: {args.students} per profile, {SESSIONS} sessions x {PER_SESSION} questions, bank = {source}", "",
             "| Profile | Policy | True knowledge gain | Gain on weak topics | Estimate error start → end | Repetition rate | Forced reuse (finite bank) |",
             "| --- | --- | --- | --- | --- | --- | --- |"]
    for prof in PROFILES:
        for pol in POLICIES:
            r = results[prof][pol]
            ms, me = mean_sd([x["err_start"] for x in r])[0], mean_sd([x["err_end"] for x in r])[0]
            lines.append(f"| {prof} | {pol} | {fmt([x['true_gain'] for x in r], True)} | "
                         f"{fmt([x['weak_gain'] for x in r], True)} | {ms:.3f} → {me:.3f} | "
                         f"{fmt([x['repetition_rate'] for x in r], True)} | {fmt([x['reuse_rate'] for x in r], True)} |")
    lines += ["", "### Paired difference, adaptive minus random (same students)", "",
              "| Profile | Δ true gain | Δ weak-topic gain | Students where adaptive > random |", "| --- | --- | --- | --- |"]
    summary = {}
    for prof in PROFILES:
        a, b = results[prof]["adaptive"], results[prof]["random"]
        d = [x["true_gain"] - y["true_gain"] for x, y in zip(a, b)]
        dw = [x["weak_gain"] - y["weak_gain"] for x, y in zip(a, b) if x["weak_gain"] is not None]
        wins = sum(v > 0 for v in d) / len(d)
        se = lambda v: (statistics.stdev(v) / math.sqrt(len(v))) if len(v) > 1 else 0.0
        lines.append(f"| {prof} | {statistics.mean(d) * 100:+.2f} pts (± {se(d) * 100:.2f} s.e.) | "
                     f"{('%+.2f pts (± %.2f s.e.)' % (statistics.mean(dw) * 100, se(dw) * 100)) if dw else '-'} | {wins * 100:.0f}% |")
        summary[prof] = {"delta_true_gain": statistics.mean(d), "delta_weak_gain": statistics.mean(dw) if dw else None,
                         "adaptive_wins": wins}
    print("\n".join(lines))

    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump({
        "config": {"students_per_profile": args.students, "sessions": SESSIONS, "per_session": PER_SESSION,
                   "seed": args.seed, "bank_source": source, "bank_size": len(questions),
                   "estimator": {"p_init": learner.P_INIT, "p_learn": learner.P_LEARN, "p_slip": learner.P_SLIP,
                                 "guess": learner.GUESS, "diff_guess": learner.DIFF_GUESS, "diff_slip": learner.DIFF_SLIP},
                   "hidden_student": {"slip": TRUE_SLIP, "guess": TRUE_GUESS, "learn": TRUE_LEARN,
                                      "learn_if_wrong": LEARN_IF_WRONG}},
        "paired_differences": summary,
        "mean_trajectory_true_knowledge": {
            prof: {pol: [statistics.mean(x["traj"][i] for x in results[prof][pol]) for i in range(SESSIONS + 1)]
                   for pol in POLICIES} for prof in PROFILES},
        "table_markdown": "\n".join(lines),
    }, open(f"{OUT_DIR}/simulation.json", "w"), indent=1)
    print(f"\nSaved {OUT_DIR}/simulation.json")


if __name__ == "__main__":
    main()