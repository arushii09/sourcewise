"""Evaluate the retrieval + generation pipeline on eval/test_set.json.

One-time install (in your .venv):
    pip install ragas "langchain-community<0.4"
(ragas 0.4.x fails to import with langchain-community 0.4+, hence the pin.)

Run from the project root (the API server does NOT need to be running):
    python backend\\eval_rag.py                 # everything
    python backend\\eval_rag.py --skip-ragas    # only retrieval / citation / refusal metrics (no judge calls)
    python backend\\eval_rag.py --ragas-limit 15   # RAGAS on a subset if you are short on time or quota

What it measures
  Retrieval        hit@k and MRR against your hand-verified gold locations
  Citations        precision and hit rate of the citations the tutor actually returns
  Refusals         off-material questions must be declined; in-scope ones must not be
  RAGAS            faithfulness, answer relevancy, context precision, context recall (LLM judge via Groq)

Everything is cached under eval/results/ so an interrupted run resumes without repeating calls.
CAVEAT printed in the report: gold lists are hand-verified but not exhaustive, so citation precision is a
lower bound; the RAGAS judge is an LLM and is noisy, especially on small samples.
"""
import argparse
import asyncio
import json
import math
import os
import random
import statistics
import sys
import time

sys.path.insert(0, os.getcwd())
from dotenv import load_dotenv  # noqa: E402

load_dotenv()

OUT_DIR = "eval/results"
TEST_SET = "eval/test_set.json"
ANSWER_CACHE = f"{OUT_DIR}/answers_cache.json"
RAGAS_CACHE = f"{OUT_DIR}/ragas_cache.json"
VIDEO_TOL = 45          # seconds: a video citation within this of a gold time counts as a match


def load_json(path, default):
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else default


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(obj, open(path, "w", encoding="utf-8"), indent=1)


def matches(src_type, loc, gold):
    for g in gold:
        if g["source_type"] != src_type:
            continue
        if src_type == "video":
            if abs(loc - g["loc_num"]) <= VIDEO_TOL:
                return True
        elif loc == g["loc_num"]:
            return True
    return False


def run_pipeline(app, q, gate, model):
    """Call the real chat() function and keep what the generator saw. Cached per question."""
    from fastapi import HTTPException
    hits = app.retrieve(q)
    retrieved = [{"source_type": m["source_type"], "loc_num": m["loc_num"],
                  "text": " ".join(d.split()[:app.EXCERPT_WORDS]), "dist": round(dist, 4)} for d, m, dist in hits]
    for _ in range(5):
        try:
            r = app.chat(app.ChatIn(question=q))
            break
        except HTTPException as e:       # rate limit or model hiccup
            print(f"   model call failed ({e.detail[:80]}); waiting 20s")
            time.sleep(20)
    else:
        raise RuntimeError("chat() kept failing")
    return {"answer": r["answer"], "grounded": r["grounded"], "citations": r["citations"],
            "retrieved": retrieved, "best_dist": r["debug"]["best_dist"], "reason": r["debug"]["reason"]}


def mean(xs):
    xs = [x for x in xs if x is not None]
    return statistics.mean(xs) if xs else None


def pct(x):
    return "-" if x is None else f"{x * 100:.1f}%"


def build_ragas(app):
    from openai import AsyncOpenAI
    from ragas.embeddings import BaseRagasEmbedding
    from ragas.llms import llm_factory
    from ragas.metrics.collections import AnswerRelevancy, ContextPrecision, ContextRecall, Faithfulness

    judge = os.getenv("MODEL_JUDGE") or os.getenv("MODEL_VERIFY") or os.getenv("MODEL_MAIN")
    print(f"RAGAS judge model: {judge}  (generator: {os.getenv('MODEL_MAIN')})"
          + ("  [same model judges its own answers: note this bias in your report]" if judge == os.getenv("MODEL_MAIN") else ""))
    client = AsyncOpenAI(base_url=os.getenv("JUDGE_BASE_URL", "https://api.groq.com/openai/v1"),
                         api_key=os.getenv("GROQ_API_KEY"), max_retries=6)   # honours Groq retry-after on 429
    llm = llm_factory(judge, provider="openai", client=client, temperature=0, max_tokens=3000)

    class LocalEmbeddings(BaseRagasEmbedding):
        def embed_text(self, text, **kw):
            return app.embedder.encode([text], normalize_embeddings=True)[0].tolist()

        async def aembed_text(self, text, **kw):
            return self.embed_text(text)

    return {
        "faithfulness": Faithfulness(llm=llm),
        "answer_relevancy": AnswerRelevancy(llm=llm, embeddings=LocalEmbeddings(), strictness=2),
        "context_precision": ContextPrecision(llm=llm),
        "context_recall": ContextRecall(llm=llm),
    }, judge


async def ascore(rcache, key, make):
    """Run one RAGAS metric with retries; failures stay None so a rerun retries them."""
    if rcache.get(key) is not None:
        return rcache[key], ""
    last = ""
    for _ in range(4):
        try:
            v = float((await make()).value)
            if math.isnan(v):
                raise ValueError("nan score")
            rcache[key] = v
            save_json(RAGAS_CACHE, rcache)
            return v, ""
        except Exception as e:  # rate limit, bad structured output, ...
            last = str(e)
            print(f"   {key.split('|')[-1]}: {last[:100]}")
            await asyncio.sleep(20 if ("429" in last or "rate" in last.lower()) else 3)
    rcache[key] = None
    return None, last


async def run_ragas(metrics, sample, tag, rcache):
    per = {k: [] for k in metrics}
    errors, scored_any = [], False
    for i, x in enumerate(sample, 1):
        it, r = x["item"], x["res"]
        ctx = [h["text"] for h in r["retrieved"]]
        print(f" RAGAS {i}/{len(sample)} {it['id']}")
        base = f"{it['id']}|{tag}"
        jobs = [("context_precision", "cp", lambda: metrics["context_precision"].ascore(
                    user_input=it["question"], reference=it["reference_answer"], retrieved_contexts=ctx)),
                ("context_recall", "cr", lambda: metrics["context_recall"].ascore(
                    user_input=it["question"], retrieved_contexts=ctx, reference=it["reference_answer"]))]
        if r["grounded"]:
            jobs += [("faithfulness", "f", lambda: metrics["faithfulness"].ascore(
                        user_input=it["question"], response=r["answer"], retrieved_contexts=ctx)),
                     ("answer_relevancy", "ar", lambda: metrics["answer_relevancy"].ascore(
                        user_input=it["question"], response=r["answer"]))]
        for name, short, make in jobs:
            v, err = await ascore(rcache, f"{base}|{short}", make)
            per[name].append(v)
            scored_any = scored_any or v is not None
            if err:
                errors.append(err)
        if i >= 2 and not scored_any:        # fail fast instead of burning quota on a broken judge
            print("\nStopping RAGAS: the first questions produced no scores at all.\nLast error: " + (errors[-1] if errors else "?")[:300])
            break
    return per


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-ragas", action="store_true")
    ap.add_argument("--ragas-limit", type=int, default=0, help="0 = all in-scope questions")
    args = ap.parse_args()

    ts = json.load(open(TEST_SET, encoding="utf-8"))
    in_scope, off_topic = ts["in_scope"], ts["off_topic"]
    print("Loading the pipeline (embedding model, Chroma)...")
    from backend import main as app

    model, gate = os.getenv("MODEL_MAIN"), app.GATE_DIST
    cache = load_json(ANSWER_CACHE, {})
    tag = f"{model}|{gate}|{app.TOP_K}"

    def get(item):
        key = f"{item['id']}|{tag}|{item['question']}"
        if key not in cache:
            print(f" {item['id']}: {item['question'][:70]}")
            cache[key] = run_pipeline(app, item["question"], gate, model)
            save_json(ANSWER_CACHE, cache)
        return cache[key]

    # ---------------- in-scope: retrieval, citations, refusals
    rows = []
    for it in in_scope:
        r = get(it)
        ranks = [i for i, h in enumerate(r["retrieved"], 1) if matches(h["source_type"], h["loc_num"], it["gold"])]
        cites = r["citations"]
        good = [matches(c["source_type"], c["loc_num"], it["gold"]) for c in cites]
        rows.append({"id": it["id"], "question": it["question"], "modality": it.get("modality"), "grounded": r["grounded"],
                     "hit_at_k": bool(ranks), "rr": 1 / ranks[0] if ranks else 0.0,
                     "cite_precision": (sum(good) / len(good)) if good else None, "cite_hit": any(good) if good else None,
                     "answer": r["answer"], "best_dist": r["best_dist"], "reason": r["reason"],
                     "cites": [f"{c['source_type']} {c['loc_num']}" for c in cites],
                     "gold": [f"{g['source_type']} {g['loc_num']}" for g in it["gold"]], "item": it, "res": r})
    answered = [x for x in rows if x["grounded"]]

    # ---------------- off-topic refusals
    off_rows = []
    for it in off_topic:
        r = get(it)
        off_rows.append({"id": it["id"], "kind": it["kind"], "question": it["question"], "refused": not r["grounded"],
                         "best_dist": r["best_dist"], "reason": r["reason"], "answer": r["answer"] if r["grounded"] else ""})

    summary = {
        "n_in_scope": len(rows), "n_off_topic": len(off_rows),
        "retrieval_hit_at_k": mean([x["hit_at_k"] for x in rows]), "retrieval_mrr": mean([x["rr"] for x in rows]),
        "answer_rate_in_scope": len(answered) / len(rows),
        "false_refusal_rate": 1 - len(answered) / len(rows),
        "citation_hit_rate": mean([x["cite_hit"] for x in answered]),
        "citation_precision": mean([x["cite_precision"] for x in answered]),
        "refusal_accuracy_all": mean([x["refused"] for x in off_rows]),
        "refusal_accuracy_unrelated": mean([x["refused"] for x in off_rows if x["kind"] == "unrelated"]),
        "refusal_accuracy_near_topic": mean([x["refused"] for x in off_rows if x["kind"] == "near_topic"]),
        "by_modality_hit_at_k": {m: mean([x["hit_at_k"] for x in rows if x["modality"] == m])
                                 for m in sorted({x["modality"] for x in rows if x["modality"]})},
    }

    # ---------------- RAGAS
    ragas_scores = {}
    if not args.skip_ragas:
        try:
            metrics, judge = build_ragas(app)
        except ImportError as e:
            print(f"\nRAGAS is not installed or failed to import ({e}).\n"
                  'Run:  pip install ragas "langchain-community<0.4"   then rerun. Continuing without RAGAS.')
            metrics = None
        if metrics:
            rcache = load_json(RAGAS_CACHE, {})
            sample = list(rows)
            if args.ragas_limit:
                random.Random(0).shuffle(sample)
                sample = sample[:args.ragas_limit]
            per = asyncio.run(run_ragas(metrics, sample, tag, rcache))
            for k, v in per.items():
                ok = [x for x in v if x is not None]
                ragas_scores[k] = {"mean": mean(ok), "n_scored": len(ok), "n_failed": len(v) - len(ok)}
            ragas_scores["judge_model"] = judge

    # ---------------- report
    L = ["## RAG evaluation results", "",
         f"Test set: {summary['n_in_scope']} in-scope questions with hand-verified gold locations, {summary['n_off_topic']} off-material questions. "
         f"Generator: `{model}`, retrieval top-k = {app.TOP_K}, gate distance = {gate}.", "",
         "| Metric | Value |", "| --- | --- |",
         f"| Retrieval hit@{app.TOP_K} (gold source among retrieved) | {pct(summary['retrieval_hit_at_k'])} |",
         f"| Retrieval MRR | {summary['retrieval_mrr']:.3f} |",
         f"| In-scope questions answered (1 - false refusal) | {pct(summary['answer_rate_in_scope'])} |",
         f"| Answers with at least one correct citation | {pct(summary['citation_hit_rate'])} |",
         f"| Citation precision (lower bound; gold is not exhaustive) | {pct(summary['citation_precision'])} |",
         f"| Refusal accuracy, all off-material | {pct(summary['refusal_accuracy_all'])} |",
         f"| Refusal accuracy, unrelated | {pct(summary['refusal_accuracy_unrelated'])} |",
         f"| Refusal accuracy, near-topic | {pct(summary['refusal_accuracy_near_topic'])} |"]
    for m, v in summary["by_modality_hit_at_k"].items():
        L.append(f"| Retrieval hit@{app.TOP_K}, {m} questions | {pct(v)} |")
    if ragas_scores:
        L += ["", f"RAGAS (judge `{ragas_scores['judge_model']}`):", "", "| RAGAS metric | Mean | Scored | Failed |", "| --- | --- | --- | --- |"]
        for k in ("faithfulness", "answer_relevancy", "context_precision", "context_recall"):
            v = ragas_scores[k]
            L.append(f"| {k} | {('%.3f' % v['mean']) if v['mean'] is not None else '-'} | {v['n_scored']} | {v['n_failed']} |")
    fails = [x for x in rows if not x["hit_at_k"] or not x["grounded"] or x["cite_hit"] is False]
    L += ["", f"### Failure cases ({len(fails)} of {len(rows)} in-scope questions)", ""]
    for x in fails:
        why = "refused" if not x["grounded"] else ("gold source not retrieved" if not x["hit_at_k"] else "cited source not in gold")
        L.append(f"- {x['id']} ({why}): {x['question']}  | gold: {', '.join(x['gold'])} | cited: {', '.join(x['cites']) or 'none'}")
    bad_off = [x for x in off_rows if not x["refused"]]
    L += ["", f"### Off-material questions that were answered instead of refused ({len(bad_off)})", ""]
    for x in bad_off:
        L.append(f"- {x['id']} ({x['kind']}, best_dist {x['best_dist']}): {x['question']}")
    L += ["", "Caveats: gold locations were hand-verified but are not exhaustive; the RAGAS judge is an LLM and noisy on small samples; "
              "numbers are from a single run on one course unit."]
    report = "\n".join(L)
    print("\n" + report)

    save_json(f"{OUT_DIR}/rag_eval.json", {"summary": summary, "ragas": ragas_scores,
              "per_question": [{k: v for k, v in x.items() if k not in ("item", "res")} for x in rows], "off_topic": off_rows})
    open(f"{OUT_DIR}/rag_eval.md", "w", encoding="utf-8").write(report)
    print(f"\nSaved {OUT_DIR}/rag_eval.json and {OUT_DIR}/rag_eval.md")


if __name__ == "__main__":
    main()