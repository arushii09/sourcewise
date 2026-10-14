"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  API,
  Citation,
  Course,
  HeaderNav,
  LearnerState,
  Recommended,
  Viewer,
  CitationChip,
  getMasteryColor,
  place,
  useCourse,
  useStudent,
} from "../shared";

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
  const [selectedCourseId, setSelectedCourseId] = useCourse("default");
  const [coursesList, setCoursesList] = useState<Course[]>([]);
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

  // Load courses list
  const loadCourses = useCallback(async () => {
    try {
      const r = await fetch(`${API}/courses`);
      if (r.ok) {
        const list: Course[] = await r.json();
        setCoursesList(list);
      }
    } catch {
      // Backend not yet reachable
    }
  }, []);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

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
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelected([t]);
        sessionStorage.removeItem("sw_quiz_topic");
      }
    } catch {
      /* ignore */
    }
  }, []);

  // When course changes, reset quiz questions so cross-course questions are never reused
  const handleCourseChange = (newCourseId: string) => {
    setSelectedCourseId(newCourseId);
    if (phase !== "setup") {
      setPhase("setup");
      setQuestions([]);
      setSession("");
      setAnswer("");
      setFeedback(null);
      setReport(null);
      setError("");
    }
  };

  const activeCourse = coursesList.find((c) => c.id === selectedCourseId);
  const activeCourseChunks = selectedCourseId === "all"
    ? coursesList.reduce((acc, c) => acc + (c.chunks_count || 0), 0)
    : activeCourse?.chunks_count ?? 0;

  const attempts = state ? state.topics.reduce((a, t) => a + t.n, 0) : 0;

  async function start(diagnostic: boolean, topics?: string[]) {
    setError("");
    setPhase("loading");
    try {
      const chosen = topics ?? (selected.length ? selected : null);
      const d = await api<{ session: string; questions: Question[] }>("/quiz/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student,
          topics: diagnostic ? null : chosen,
          n: count,
          types,
          diagnostic,
          course: selectedCourseId === "all" ? undefined : selectedCourseId,
        }),
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
  const card = "rounded-2xl border border-[#F3D2DC] bg-white p-6 sm:p-8 shadow-xs";

  return (
    <div className="min-h-screen bg-[#FDF2F5] font-sans text-[#1F1A1D] selection:bg-[#E11D48]/20 selection:text-[#E11D48]">
      <HeaderNav student={student} setStudent={setStudent} subtitle="Adaptive mastery testing" />
      <main className="mx-auto max-w-[960px] space-y-6 px-4 sm:px-6 py-8">
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {phase === "setup" && (
          <div className={card}>
            <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-[#1F1A1D] leading-tight">
              Practice quiz
            </h1>
            <p className="mt-1.5 text-sm text-[#71646B] leading-relaxed">
              Questions come from your course material, are checked by a second model, and are never repeated for you.
            </p>

            {/* Course Selector Toolbar (matches Tutor Chat) */}
            <div className="mt-6 rounded-xl border border-[#F3D2DC] bg-[#FFF0F4] p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#F3D2DC] bg-white text-[#E11D48]">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                  </div>
                  <span className="font-semibold text-[#71646B]">Course:</span>
                  <select
                    value={selectedCourseId}
                    onChange={(e) => handleCourseChange(e.target.value)}
                    className="cursor-pointer rounded-lg border border-[#F3D2DC] bg-white px-3 py-1.5 text-xs font-semibold text-[#1F1A1D] outline-none transition focus:border-[#E11D48] focus:ring-1 focus:ring-[#E11D48]"
                  >
                    {coursesList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.chunks_count ? `(${c.chunks_count} chunks)` : ""}
                      </option>
                    ))}
                    <option value="all">All Courses (All indexed materials)</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 text-[#71646B]">
                  <span>{activeCourseChunks.toLocaleString()} chunks indexed</span>
                  <span>·</span>
                  <Link href="/sources" className="text-xs font-semibold text-[#E11D48] hover:text-[#F43F5E] hover:underline">
                    Manage sources &rarr;
                  </Link>
                </div>
              </div>

              {activeCourseChunks === 0 && selectedCourseId !== "all" && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Notice: No sources are indexed yet for this course. Please upload course material or switch to All Courses to generate questions.
                </div>
              )}
            </div>

            {state && attempts === 0 && (
              <div className="mt-6 rounded-2xl border border-[#FBCFE8] bg-[#FDF2F8] p-5 text-sm text-[#1F1A1D]">
                <p className="font-semibold text-[#9D174D]">New here? Start with the diagnostic</p>
                <p className="mt-1 text-xs sm:text-sm text-[#71646B]">
                  One question per topic, so the tutor can estimate what you already know.
                </p>
                <button
                  onClick={() => start(true)}
                  className="mt-3.5 inline-block cursor-pointer rounded-xl bg-[#E11D48] px-4.5 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-[#F43F5E] active:scale-[0.98]"
                >
                  Take the diagnostic ({state.topics.length} questions)
                </button>
              </div>
            )}

            <div className="mt-6">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#71646B]">
                Topics {selected.length === 0 && <span className="font-normal normal-case text-[#A1939A]">(none selected = all, weighted to your weak spots)</span>}
              </h2>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {state?.topics.map((t) => {
                  const on = selected.includes(t.topic);
                  return (
                    <button
                      key={t.topic}
                      onClick={() => setSelected(on ? selected.filter((x) => x !== t.topic) : [...selected, t.topic])}
                      className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-xs sm:text-sm transition-all duration-150 ${on
                          ? "border-[#E11D48] bg-[#FFF0F4] text-[#BE123C] font-semibold shadow-2xs"
                          : "border-[#F3D2DC] bg-white text-[#71646B] hover:border-[#E11D48]/40 hover:text-[#1F1A1D]"
                        }`}
                    >
                      {t.name} <span className="ml-1 text-xs opacity-75 font-normal">{pct(t.p)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div>
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#71646B]">
                  Questions
                </h2>
                <div className="mt-2.5 flex gap-2">
                  {[3, 5, 8].map((n) => (
                    <button
                      key={n}
                      onClick={() => setCount(n)}
                      className={`cursor-pointer rounded-xl border px-4 py-2 text-sm font-medium transition-all duration-150 ${count === n
                          ? "border-[#E11D48] bg-[#FFF0F4] text-[#BE123C] font-semibold shadow-2xs"
                          : "border-[#F3D2DC] bg-white text-[#71646B] hover:border-[#E11D48]/40 hover:text-[#1F1A1D]"
                        }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#71646B]">
                  Types
                </h2>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {(["mcq", "short", "numerical"] as const).map((t) => {
                    const on = types.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() => setTypes(on ? (types.length > 1 ? types.filter((x) => x !== t) : types) : [...types, t])}
                        className={`cursor-pointer rounded-xl border px-3.5 py-2 text-sm font-medium transition-all duration-150 ${on
                            ? "border-[#E11D48] bg-[#FFF0F4] text-[#BE123C] font-semibold shadow-2xs"
                            : "border-[#F3D2DC] bg-white text-[#71646B] hover:border-[#E11D48]/40 hover:text-[#1F1A1D]"
                          }`}
                      >
                        {TYPE_LABEL[t]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3 border-t border-[#F3D2DC] pt-6">
              <button
                onClick={() => start(false)}
                disabled={!state}
                className="cursor-pointer rounded-xl bg-[#E11D48] px-6 py-2.5 text-sm font-semibold text-white shadow-xs transition-all duration-150 hover:bg-[#F43F5E] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Start quiz
              </button>
              {attempts > 0 && (
                <button
                  onClick={() => start(true)}
                  className="cursor-pointer rounded-xl border border-[#F3D2DC] bg-white px-5 py-2.5 text-sm font-medium text-[#1F1A1D] shadow-2xs transition-all duration-150 hover:border-[#E11D48]/50 hover:bg-[#FFF0F4]"
                >
                  Re-take diagnostic
                </button>
              )}
            </div>
          </div>
        )}

        {phase === "loading" && (
          <div className="rounded-2xl border border-[#F3D2DC] bg-white p-8 sm:p-12 text-center shadow-xs">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] text-[#E11D48] animate-pulse">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <p className="text-base font-semibold text-[#1F1A1D]">Generating and verifying questions&hellip;</p>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-[#71646B]">
              Each question is written from {activeCourse ? activeCourse.name : "your material"} and checked by a second model.
            </p>
          </div>
        )}

        {(phase === "question" || phase === "feedback") && q && (
          <div className={card}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[#F3D2DC] bg-[#FFF0F4] px-2.5 py-1 text-xs font-medium text-[#71646B]">
                Question {i + 1} of {questions.length}
              </span>
              <span className="rounded-full border border-[#FBCFE8] bg-[#FDF2F8] px-2.5 py-1 text-xs font-semibold text-[#9D174D]">
                {q.topic_name}
              </span>
              <span className="rounded-full border border-[#F3D2DC] bg-[#FFF0F4] px-2.5 py-1 text-xs text-[#71646B]">
                {q.difficulty}
              </span>
              <span className="rounded-full border border-[#F3D2DC] bg-[#FFF0F4] px-2.5 py-1 text-xs text-[#71646B]">
                {TYPE_LABEL[q.type]}
              </span>
            </div>

            <p className="text-xl sm:text-2xl font-semibold leading-snug tracking-tight text-[#1F1A1D]">
              {q.question}
            </p>

            {phase === "question" && (
              <>
                {q.type === "mcq" && (
                  <div className="mt-5 space-y-2.5">
                    {q.options?.map((o, idx) => {
                      const isSelected = answer === String(idx);
                      return (
                        <button
                          key={idx}
                          onClick={() => setAnswer(String(idx))}
                          className={`flex w-full cursor-pointer items-center rounded-xl border p-4 text-left text-sm sm:text-base transition-all duration-150 ${isSelected
                              ? "border-2 border-[#E11D48] bg-[#FFF0F4] text-[#1F1A1D] font-medium shadow-2xs"
                              : "border-[#F3D2DC] bg-white text-[#1F1A1D] hover:border-[#E11D48]/40 hover:bg-[#FFF0F4]/40"
                            }`}
                        >
                          <span
                            className={`mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${isSelected
                                ? "bg-[#E11D48] text-white"
                                : "bg-[#FFF0F4] text-[#71646B] border border-[#F3D2DC]"
                              }`}
                          >
                            {"ABCD"[idx]}
                          </span>
                          <span className="flex-1 leading-relaxed">{o}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {q.type === "numerical" && (
                  <input
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    inputMode="decimal"
                    placeholder="Enter a number"
                    className="mt-5 w-full rounded-xl border border-[#F3D2DC] bg-white px-4 py-3 text-sm sm:text-base text-[#1F1A1D] outline-none transition focus:border-[#E11D48] focus:ring-2 focus:ring-[#E11D48]/15 placeholder:text-[#A1939A]"
                  />
                )}

                {q.type === "short" && (
                  <textarea
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    rows={3}
                    placeholder="Answer in a sentence or two"
                    className="mt-5 w-full rounded-xl border border-[#F3D2DC] bg-white px-4 py-3 text-sm sm:text-base text-[#1F1A1D] outline-none transition focus:border-[#E11D48] focus:ring-2 focus:ring-[#E11D48]/15 placeholder:text-[#A1939A]"
                  />
                )}

                <div className="mt-6 pt-2">
                  <button
                    onClick={submit}
                    disabled={!answer.trim() || busy}
                    className="cursor-pointer rounded-xl bg-[#E11D48] px-6 py-2.5 text-sm font-semibold text-white shadow-xs transition-all duration-150 hover:bg-[#F43F5E] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? "Checking…" : "Submit answer"}
                  </button>
                </div>
              </>
            )}

            {phase === "feedback" && feedback && (
              <div className="mt-5 space-y-4">
                {q.type === "mcq" && q.options && (
                  <div className="space-y-2.5">
                    {q.options.map((o, idx) => {
                      const isCorrect = o === feedback.correct_answer;
                      const isChosen = answer === String(idx);
                      const cls = isCorrect
                        ? "border-2 border-emerald-500 bg-emerald-50 text-[#1F1A1D]"
                        : isChosen
                          ? "border-2 border-rose-500 bg-rose-50 text-[#1F1A1D]"
                          : "border border-[#F3D2DC] bg-white opacity-50 text-[#71646B]";
                      return (
                        <div key={idx} className={`flex w-full items-center rounded-xl p-4 text-sm sm:text-base ${cls}`}>
                          <span className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold border border-[#F3D2DC]">
                            {"ABCD"[idx]}
                          </span>
                          <span className="flex-1 leading-relaxed">{o}</span>
                          {isCorrect && (
                            <span className="ml-3 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700">
                              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              Correct answer
                            </span>
                          )}
                          {isChosen && !isCorrect && (
                            <span className="ml-3 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-rose-700">
                              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                              </svg>
                              Your answer
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div
                  className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${feedback.correct
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-rose-200 bg-rose-50 text-rose-800"
                    }`}
                >
                  {feedback.correct ? (
                    <>
                      <svg className="h-4 w-4 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span>Correct</span>
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4 text-rose-600" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                      <span>Not quite</span>
                      <span className="ml-2 font-normal text-[#1F1A1D]">Answer: {feedback.correct_answer}</span>
                    </>
                  )}
                </div>

                {feedback.explanation && (
                  <p className="rounded-xl border border-[#F3D2DC] bg-[#FFF0F4] p-4 text-sm sm:text-base leading-relaxed text-[#71646B]">
                    {feedback.explanation}
                  </p>
                )}

                {feedback.misconception && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <span className="font-semibold">Likely misconception: </span>
                    {feedback.misconception}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 border-t border-[#F3D2DC] pt-4">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#71646B]">Source</span>
                  <CitationChip c={feedback.citation} onOpen={setViewer} showN={false} />
                  <span className="ml-auto text-xs text-[#71646B]">
                    {feedback.mastery.topic_name}: {pct(feedback.mastery.before)} &rarr;{" "}
                    <b className={feedback.mastery.after >= feedback.mastery.before ? "text-[#E11D48]" : "text-rose-600"}>
                      {pct(feedback.mastery.after)}
                    </b>
                  </span>
                </div>

                <div className="pt-2">
                  <button
                    onClick={next}
                    className="cursor-pointer rounded-xl bg-[#E11D48] px-6 py-2.5 text-sm font-semibold text-white shadow-xs transition-all duration-150 hover:bg-[#F43F5E] active:scale-[0.98]"
                  >
                    {i + 1 < questions.length ? "Next question" : "See my report"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {phase === "report" && report && (
          <div className="space-y-6">
            <div className={card}>
              <h1 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#71646B]">
                Quiz report
              </h1>
              <p className="mt-2 text-4xl sm:text-5xl font-semibold tracking-tight text-[#E11D48]">
                {report.score}/{report.total}{" "}
                <span className="text-base sm:text-lg font-normal text-[#71646B]">correct</span>
              </p>

              <div className="mt-6 space-y-4">
                {report.topics.map((t) => (
                  <div key={t.topic}>
                    <div className="mb-1.5 flex items-baseline justify-between text-sm">
                      <span className="font-medium text-[#1F1A1D]">
                        {t.name}{" "}
                        {t.weak && (
                          <span className="ml-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-amber-800">
                            weak
                          </span>
                        )}
                      </span>
                      <span className="text-sm font-semibold text-[#1F1A1D]">
                        {t.correct}/{t.total} correct
                        {t.mastery !== null && (
                          <span className="text-xs font-normal text-[#71646B]"> · mastery {pct(t.mastery)}</span>
                        )}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#FFE4E6]">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: pct(t.mastery ?? 0),
                          backgroundColor: getMasteryColor(t.mastery ?? 0),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {report.misconceptions.length > 0 && (
              <div className={card}>
                <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-[#1F1A1D]">
                  Likely misconceptions
                </h2>
                <div className="mt-4 space-y-3">
                  {report.misconceptions.map((m, idx) => (
                    <div key={idx} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm space-y-2">
                      <p className="font-semibold text-amber-800">
                        {m.topic_name}: {m.misconception}
                      </p>
                      <p className="text-xs text-[#71646B]">From: {m.question}</p>
                      <div className="pt-1">
                        <CitationChip c={m.citation} onOpen={setViewer} showN={false} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={card}>
              <p className="text-sm sm:text-base text-[#71646B]">
                Recommended next: <b className="text-[#1F1A1D]">{report.recommended.name}</b>{" "}
                <span className="text-[#A1939A]">· {report.recommended.reason}</span>
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => start(false, [report.recommended.topic])}
                  className="cursor-pointer rounded-xl bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-all duration-150 hover:bg-[#F43F5E] active:scale-[0.98]"
                >
                  Practice this topic
                </button>
                <button
                  onClick={() => router.push("/dashboard")}
                  className="cursor-pointer rounded-xl border border-[#F3D2DC] bg-white px-5 py-2.5 text-sm font-medium text-[#1F1A1D] shadow-2xs transition-all duration-150 hover:border-[#E11D48]/50 hover:bg-[#FFF0F4]"
                >
                  View dashboard
                </button>
                <button
                  onClick={() => setPhase("setup")}
                  className="cursor-pointer rounded-xl border border-[#F3D2DC] bg-white px-5 py-2.5 text-sm font-medium text-[#1F1A1D] shadow-2xs transition-all duration-150 hover:border-[#E11D48]/50 hover:bg-[#FFF0F4]"
                >
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