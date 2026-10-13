"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API, Citation, LearnerState, Nav, Recommended, SourceChip, Viewer, masteryColor, useStudent } from "../shared";

type Question = {
  id: string;
  type: "mcq" | "short" | "numerical";
  topic: string;
  topic_name: string;
  difficulty: string;
  question: string;
  options?: string[];
};
type Feedback = {
  correct: boolean;
  correct_answer: string;
  explanation: string;
  misconception: string | null;
  mastery: { topic: string; topic_name: string; before: number; after: number };
  citation: Citation;
};
type Report = {
  session: string;
  score: number;
  total: number;
  topics: { topic: string; name: string; correct: number; total: number; accuracy: number; mastery: number | null; weak: boolean }[];
  weak_topics: { topic: string; name: string }[];
  misconceptions: { topic_name: string; misconception: string; question: string; citation: Citation }[];
  recommended: Recommended;
};

const TYPE_LABEL = { mcq: "Multiple choice", short: "Short answer", numerical: "Numerical" } as const;
const pct = (p: number) => `${Math.round(p * 100)}%`;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, init);
  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      detail = (await r.json()).detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new Error(detail);
  }
  return r.json();
}

export default function QuizPage() {
  const router = useRouter();
  const [student, setStudent] = useStudent();
  const [state, setState] = useState<LearnerState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [count, setCount] = useState(5);
  const [types, setTypes] = useState<string[]>(["mcq", "short", "numerical"]);
  const [phase, setPhase] = useState<"setup" | "loading" | "question" | "feedback" | "report">("setup");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [session, setSession] = useState("");
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<Citation | null>(null);

  const loadState = useCallback(() => {
    if (!student) return;
    api<LearnerState>(`/learner/${student}`).then(setState).catch((e: Error) => setError(e.message));
  }, [student]);

  useEffect(() => {
    if (phase === "setup") loadState();
  }, [phase, loadState]);

  useEffect(() => {
    try {
      const t = sessionStorage.getItem("sw_quiz_topic");
      if (t) {
        setSelected([t]);
        sessionStorage.removeItem("sw_quiz_topic");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const attempts = state ? state.topics.reduce((a, t) => a + t.n, 0) : 0;

  async function start(diagnostic: boolean, topics?: string[]) {
    setError("");
    setPhase("loading");
    try {
      const chosen = topics ?? (selected.length ? selected : null);
      const d = await api<{ session: string; questions: Question[] }>("/quiz/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student, topics: diagnostic ? null : chosen, n: count, types, diagnostic }),
      });
      setQuestions(d.questions);
      setSession(d.session);
      setI(0);
      setAnswer("");
      setFeedback(null);
      setPhase("question");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("setup");
    }
  }

  async function submit() {
    const q = questions[i];
    if (!q || !answer.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const f = await api<Feedback>("/quiz/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student, question_id: q.id, answer }),
      });
      setFeedback(f);
      setPhase("feedback");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    if (i + 1 < questions.length) {
      setI(i + 1);
      setAnswer("");
      setFeedback(null);
      setPhase("question");
      return;
    }
    try {
      setReport(await api<Report>(`/quiz/report/${session}`));
      setPhase("report");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the report");
    }
  }

  const q = questions[i];
  const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Nav student={student} setStudent={setStudent} />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

        {phase === "setup" && (
          <div className={card}>
            <h1 className="text-xl font-semibold tracking-tight">Practice quiz</h1>
            <p className="mt-1 text-sm text-slate-500">
              Questions come from your course material, are checked by a second model, and are never repeated for you.
            </p>

            {state && attempts === 0 && (
              <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
                New here? Start with the diagnostic: one question per topic, so the tutor can estimate what you already know.
                <button onClick={() => start(true)} className="mt-3 block rounded-xl bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700">
                  Take the diagnostic ({state.topics.length} questions)
                </button>
              </div>
            )}

            <h2 className="mt-5 text-sm font-semibold">Topics {selected.length === 0 && <span className="font-normal text-slate-400">(none selected = all, weighted to your weak spots)</span>}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {state?.topics.map((t) => {
                const on = selected.includes(t.topic);
                return (
                  <button
                    key={t.topic}
                    onClick={() => setSelected(on ? selected.filter((x) => x !== t.topic) : [...selected, t.topic])}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300"}`}
                  >
                    {t.name} <span className="ml-1 text-xs text-slate-400">{pct(t.p)}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div>
                <h2 className="text-sm font-semibold">Questions</h2>
                <div className="mt-2 flex gap-2">
                  {[3, 5, 8].map((n) => (
                    <button key={n} onClick={() => setCount(n)} className={`rounded-lg border px-3.5 py-1.5 text-sm ${count === n ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white"}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-sm font-semibold">Types</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(["mcq", "short", "numerical"] as const).map((t) => {
                    const on = types.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() => setTypes(on ? (types.length > 1 ? types.filter((x) => x !== t) : types) : [...types, t])}
                        className={`rounded-lg border px-3 py-1.5 text-sm ${on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-500"}`}
                      >
                        {TYPE_LABEL[t]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={() => start(false)} disabled={!state} className="rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-40">
                Start quiz
              </button>
              {attempts > 0 && (
                <button onClick={() => start(true)} className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 font-medium text-slate-700 hover:border-indigo-300">
                  Re-take diagnostic
                </button>
              )}
            </div>
          </div>
        )}

        {phase === "loading" && (
          <div className={`${card} animate-pulse text-center`}>
            <p className="font-medium">Generating and verifying questions&hellip;</p>
            <p className="mt-1 text-sm text-slate-500">Each question is written from your material and checked by a second model. This can take up to a minute.</p>
          </div>
        )}

        {(phase === "question" || phase === "feedback") && q && (
          <div className={card}>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
                Question {i + 1} of {questions.length}
              </span>
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700">{q.topic_name}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{q.difficulty}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{TYPE_LABEL[q.type]}</span>
            </div>
            <p className="text-lg font-medium leading-snug">{q.question}</p>

            {phase === "question" && (
              <>
                {q.type === "mcq" && (
                  <div className="mt-4 space-y-2">
                    {q.options?.map((o, idx) => (
                      <button
                        key={idx}
                        onClick={() => setAnswer(String(idx))}
                        className={`block w-full rounded-xl border px-4 py-3 text-left text-sm transition ${answer === String(idx) ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white hover:border-indigo-300"}`}
                      >
                        <span className="mr-2 font-semibold text-slate-400">{"ABCD"[idx]}</span>
                        {o}
                      </button>
                    ))}
                  </div>
                )}
                {q.type === "numerical" && (
                  <input
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    inputMode="decimal"
                    placeholder="Enter a number"
                    className="mt-4 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-indigo-400"
                  />
                )}
                {q.type === "short" && (
                  <textarea
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    rows={3}
                    placeholder="Answer in a sentence or two"
                    className="mt-4 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-indigo-400"
                  />
                )}
                <button onClick={submit} disabled={!answer.trim() || busy} className="mt-4 rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-40">
                  {busy ? "Checking…" : "Submit answer"}
                </button>
              </>
            )}

            {phase === "feedback" && feedback && (
              <div className="mt-4 space-y-3">
                {q.type === "mcq" && q.options && (
                  <div className="space-y-2">
                    {q.options.map((o, idx) => {
                      const isCorrect = o === feedback.correct_answer;
                      const isChosen = answer === String(idx);
                      const cls = isCorrect
                        ? "border-emerald-400 bg-emerald-50"
                        : isChosen
                          ? "border-rose-300 bg-rose-50"
                          : "border-slate-200 bg-white opacity-60";
                      return (
                        <div key={idx} className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>
                          <span className="mr-2 font-semibold text-slate-400">{"ABCD"[idx]}</span>
                          {o}
                          {isCorrect && <span className="ml-2 text-xs font-semibold text-emerald-700">correct answer</span>}
                          {isChosen && !isCorrect && <span className="ml-2 text-xs font-semibold text-rose-700">your answer</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${feedback.correct ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
                  {feedback.correct ? "Correct" : "Not quite"}
                  {!feedback.correct && <span className="ml-2 font-normal">Answer: {feedback.correct_answer}</span>}
                </div>
                {feedback.explanation && <p className="text-sm leading-relaxed text-slate-700">{feedback.explanation}</p>}
                {feedback.misconception && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <span className="font-semibold">Likely misconception: </span>
                    {feedback.misconception}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Source</span>
                  <SourceChip c={feedback.citation} onOpen={setViewer} showN={false} />
                  <span className="ml-auto text-xs text-slate-500">
                    {feedback.mastery.topic_name}: {pct(feedback.mastery.before)} &rarr; <b className={feedback.mastery.after >= feedback.mastery.before ? "text-emerald-700" : "text-rose-700"}>{pct(feedback.mastery.after)}</b>
                  </span>
                </div>
                <button onClick={next} className="rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700">
                  {i + 1 < questions.length ? "Next question" : "See my report"}
                </button>
              </div>
            )}
          </div>
        )}

        {phase === "report" && report && (
          <div className="space-y-4">
            <div className={card}>
              <h1 className="text-xl font-semibold tracking-tight">Quiz report</h1>
              <p className="mt-1 text-3xl font-semibold text-indigo-700">
                {report.score}/{report.total} <span className="text-base font-normal text-slate-500">correct</span>
              </p>
              <div className="mt-4 space-y-3">
                {report.topics.map((t) => (
                  <div key={t.topic}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium">
                        {t.name} {t.weak && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">weak</span>}
                      </span>
                      <span className="text-slate-500">
                        {t.correct}/{t.total} correct{t.mastery !== null && <> · mastery {pct(t.mastery)}</>}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full ${masteryColor(t.mastery ?? 0)}`} style={{ width: pct(t.mastery ?? 0) }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {report.misconceptions.length > 0 && (
              <div className={card}>
                <h2 className="font-semibold">Likely misconceptions</h2>
                <div className="mt-3 space-y-3">
                  {report.misconceptions.map((m, idx) => (
                    <div key={idx} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
                      <p className="font-medium text-amber-900">{m.topic_name}: {m.misconception}</p>
                      <p className="mt-1 text-slate-600">From: {m.question}</p>
                      <div className="mt-2">
                        <SourceChip c={m.citation} onOpen={setViewer} showN={false} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={card}>
              <p className="text-sm text-slate-600">
                Recommended next: <b>{report.recommended.name}</b> <span className="text-slate-400">· {report.recommended.reason}</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button onClick={() => start(false, [report.recommended.topic])} className="rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700">
                  Practice this topic
                </button>
                <button onClick={() => router.push("/dashboard")} className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 font-medium text-slate-700 hover:border-indigo-300">
                  View dashboard
                </button>
                <button onClick={() => setPhase("setup")} className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 font-medium text-slate-700 hover:border-indigo-300">
                  New quiz
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      {viewer && <Viewer c={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}