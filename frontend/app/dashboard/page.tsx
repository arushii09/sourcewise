"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  API,
  Course,
  HeaderNav,
  LearnerState,
  getMasteryColor,
  useCourse,
  useStudent,
} from "../shared";

const pct = (p: number) => `${Math.round(p * 100)}%`;

function TrendChart({ history, courseName }: { history: LearnerState["history"]; courseName: string }) {
  if (!history || history.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-[#F3D2DC] bg-[#FFF0F4] py-10 px-4 text-center">
        <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#E11D48] border border-[#F3D2DC]">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-[#1F1A1D]">No historical progress yet</p>
        <p className="mt-0.5 text-xs text-[#71646B] max-w-sm">
          {history && history.length === 1
            ? "1 graded answer recorded. Complete another quiz question to chart your knowledge curve."
            : `Complete quizzes for ${courseName} to track your knowledge tracing and score progression over time.`}
        </p>
      </div>
    );
  }

  // Calculate chronological progression from actual history points
  const pts = history.map((h) => h.p);
  const W = 600;
  const H = 150;
  const L = 44; // left margin for labels
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const pad = Math.max(0.05, (hi - lo) * 0.25);
  const min = Math.max(0, lo - pad);
  const max = Math.min(1, hi + pad);
  const x = (i: number) => L + (i / (pts.length - 1)) * (W - L - 12);
  const y = (p: number) => H - 14 - ((p - min) / Math.max(0.01, max - min)) * (H - 28);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const first = pts[0];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[min, (min + max) / 2, max].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - 12} y1={y(g)} y2={y(g)} stroke="#F3D2DC" strokeDasharray="4 4" />
            <text x={L - 6} y={y(g) + 4} textAnchor="end" fontSize="11" fill="#71646B">{pct(g)}</text>
          </g>
        ))}
        <polyline points={line} fill="none" stroke="#E11D48" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p)}
            r={i === pts.length - 1 ? 5 : i === 0 ? 3.5 : 2.5}
            fill={i === pts.length - 1 ? "#BE123C" : i === 0 ? "#A1939A" : "#E11D48"}
          />
        ))}
      </svg>
      <p className="mt-2.5 text-xs text-[#71646B]">
        Mastery trend: started at {pct(first)}, currently at <span className="font-semibold text-[#E11D48]">{pct(last)}</span> ({pts.length} quiz updates recorded).
      </p>
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [student, setStudent] = useStudent();
  const [selectedCourseId, setSelectedCourseId] = useCourse("default");
  const [coursesList, setCoursesList] = useState<Course[]>([]);
  const [state, setState] = useState<LearnerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const loadState = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    setError("");
    try {
      const courseParam = selectedCourseId ? `?course=${encodeURIComponent(selectedCourseId)}` : "";
      const r = await fetch(`${API}/learner/${student}${courseParam}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: LearnerState = await r.json();
      setState(data);
    } catch {
      setError("Could not reach the backend. Is the server running on port 8000?");
    } finally {
      setLoading(false);
    }
  }, [student, selectedCourseId]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  async function reset() {
    if (!confirm(`Reset all learner progress for "${student}"?`)) return;
    await fetch(`${API}/learner/${student}`, { method: "DELETE" });
    loadState();
  }

  function practice(topic: string) {
    try {
      sessionStorage.setItem("sw_quiz_topic", topic);
    } catch {
      /* ignore */
    }
    router.push("/quiz");
  }

  const activeCourse = coursesList.find((c) => c.id === selectedCourseId);
  const activeCourseName = selectedCourseId === "all" ? "All Courses" : (activeCourse?.name ?? "Course");
  const activeCourseChunks = selectedCourseId === "all"
    ? coursesList.reduce((acc, c) => acc + (c.chunks_count || 0), 0)
    : activeCourse?.chunks_count ?? 0;

  const card = "rounded-2xl border border-[#F3D2DC] bg-white p-6 sm:p-8 shadow-xs";

  // Real assessment metrics
  const answersGraded = state?.stats?.answers_graded ?? (state ? state.topics.reduce((a, t) => a + t.n, 0) : 0);
  const quizzesCompleted = state?.stats?.quizzes_completed ?? (answersGraded > 0 ? 1 : 0);
  const averageScore = state?.stats?.average_score ?? 0;

  // Assessed topics (topics with at least one answered question)
  const assessedTopics = state?.topics.filter((t) => t.n > 0) ?? [];
  const assessedAvg = assessedTopics.length > 0
    ? assessedTopics.reduce((a, t) => a + t.p, 0) / assessedTopics.length
    : 0;

  return (
    <div className="min-h-screen bg-[#FDF2F5] font-sans text-[#1F1A1D] selection:bg-[#E11D48]/20 selection:text-[#E11D48]">
      <HeaderNav student={student} setStudent={setStudent} subtitle="Mastery & knowledge tracing" />

      <main className="mx-auto max-w-[960px] space-y-6 px-4 sm:px-6 py-8">
        {/* Course Selector Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#F3D2DC] bg-white px-5 py-3.5 shadow-2xs">
          <div className="flex items-center gap-2">
            <label htmlFor="dashboard-course-select" className="text-xs font-semibold uppercase tracking-wider text-[#71646B]">
              Course
            </label>
            <select
              id="dashboard-course-select"
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="cursor-pointer rounded-lg border border-[#F3D2DC] bg-[#FFF0F4] px-3 py-1.5 text-xs sm:text-sm font-semibold text-[#1F1A1D] outline-none transition focus:border-[#E11D48] focus:ring-1 focus:ring-[#E11D48]"
            >
              {coursesList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.chunks_count ? `(${c.chunks_count} chunks)` : ""}
                </option>
              ))}
              <option value="all">All Courses (All indexed materials)</option>
            </select>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#71646B]">
            <span>{activeCourseChunks.toLocaleString()} chunks indexed</span>
            <span>·</span>
            <Link href="/quiz" className="font-semibold text-[#E11D48] hover:text-[#F43F5E] hover:underline">
              Go to Quiz &rarr;
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-[#F3D2DC] bg-white p-12 text-center shadow-xs">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#FFF0F4] text-[#E11D48] animate-pulse">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[#71646B]">Loading learning progress for {activeCourseName}&hellip;</p>
          </div>
        ) : (
          <>
            {/* Empty state: Course with 0 indexed chunks */}
            {activeCourseChunks === 0 && selectedCourseId !== "all" && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-6 sm:p-8 text-center shadow-xs">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-800">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-amber-900">No Course Materials Indexed</h2>
                <p className="mt-1 text-sm text-amber-800 max-w-md mx-auto">
                  {activeCourseName} has no materials indexed yet. Upload textbook chapters, lecture slides, or YouTube videos to start practicing.
                </p>
                <Link
                  href="/sources"
                  className="mt-4 inline-block rounded-xl bg-[#E11D48] px-5 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-[#F43F5E]"
                >
                  Manage Sources &rarr;
                </Link>
              </div>
            )}

            {/* Empty state: Learner with 0 attempts */}
            {activeCourseChunks > 0 && answersGraded === 0 && (
              <div className="rounded-2xl border border-[#FBCFE8] bg-[#FDF2F8] p-6 sm:p-8 text-center shadow-xs">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#9D174D] border border-[#FBCFE8]">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-[#9D174D]">Ready to start learning {activeCourseName}?</h2>
                <p className="mt-1 text-sm text-[#71646B] max-w-md mx-auto">
                  You haven&apos;t completed any quiz questions for this course yet. Take the diagnostic quiz or start a practice session to begin tracking your mastery.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <Link
                    href="/quiz"
                    className="cursor-pointer rounded-xl bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-[#F43F5E] active:scale-[0.98]"
                  >
                    Take Diagnostic Quiz &rarr;
                  </Link>
                  <Link
                    href="/"
                    className="cursor-pointer rounded-xl border border-[#F3D2DC] bg-white px-5 py-2.5 text-sm font-medium text-[#1F1A1D] shadow-2xs transition hover:bg-[#FFF0F4]"
                  >
                    Ask Tutor Chat &rarr;
                  </Link>
                </div>
              </div>
            )}

            {/* Summary KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-[#F3D2DC] bg-white p-4 sm:p-5 shadow-xs">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#71646B]">Quizzes</p>
                <p className="mt-1.5 text-2xl sm:text-3xl font-semibold text-[#1F1A1D] tracking-tight">{quizzesCompleted}</p>
                <p className="mt-0.5 text-xs text-[#71646B]">completed</p>
              </div>

              <div className="rounded-2xl border border-[#F3D2DC] bg-white p-4 sm:p-5 shadow-xs">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#71646B]">Answers</p>
                <p className="mt-1.5 text-2xl sm:text-3xl font-semibold text-[#1F1A1D] tracking-tight">{answersGraded}</p>
                <p className="mt-0.5 text-xs text-[#71646B]">graded</p>
              </div>

              <div className="rounded-2xl border border-[#F3D2DC] bg-white p-4 sm:p-5 shadow-xs">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#71646B]">Accuracy</p>
                <p className="mt-1.5 text-2xl sm:text-3xl font-semibold text-[#E11D48] tracking-tight">
                  {answersGraded > 0 ? pct(averageScore) : "—"}
                </p>
                <p className="mt-0.5 text-xs text-[#71646B]">average score</p>
              </div>

              <div className="rounded-2xl border border-[#F3D2DC] bg-white p-4 sm:p-5 shadow-xs">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#71646B]">Mastery</p>
                <p className="mt-1.5 text-2xl sm:text-3xl font-semibold text-[#E11D48] tracking-tight">
                  {assessedTopics.length > 0 ? pct(assessedAvg) : "—"}
                </p>
                <p className="mt-0.5 text-xs text-[#71646B]">
                  {assessedTopics.length > 0 ? `${assessedTopics.length} topics tested` : "not yet assessed"}
                </p>
              </div>
            </div>

            {/* Topic Mastery Breakdown */}
            {state && state.topics.length > 0 && (
              <div className={card}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#F3D2DC] pb-4">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-[#1F1A1D]">
                      Mastery by Topic
                    </h2>
                    <p className="mt-0.5 text-xs text-[#71646B]">
                      Bayesian Knowledge Tracing (BKT) metrics for {activeCourseName}
                    </p>
                  </div>
                  <span className="text-xs text-[#71646B]">
                    {state.topics.length} topics outlined
                  </span>
                </div>

                <div className="mt-6 space-y-4">
                  {state.topics.map((t) => {
                    const isAssessed = t.n > 0;
                    return (
                      <div key={t.topic}>
                        <div className="mb-1.5 flex items-baseline justify-between text-sm">
                          <span className="font-medium text-[#1F1A1D]">{t.name}</span>
                          <span className="text-sm font-semibold text-[#1F1A1D]">
                            {isAssessed ? (
                              <>
                                {pct(t.p)}{" "}
                                <span className="text-xs font-normal text-[#71646B]">· {t.n} {t.n === 1 ? "answer" : "answers"}</span>
                              </>
                            ) : (
                              <span className="text-xs font-medium text-[#A1939A]">Unassessed (0 answers)</span>
                            )}
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-[#FFE4E6]">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: isAssessed ? pct(t.p) : "0%",
                              backgroundColor: isAssessed ? getMasteryColor(t.p) : "#E5E7EB",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Recommended Next Topic */}
            {state?.recommended && (
              <div className="rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] p-6 sm:p-8 shadow-2xs">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#BE123C]">
                  RECOMMENDED NEXT
                </p>
                <p className="mt-2 text-xl sm:text-2xl font-semibold tracking-tight text-[#1F1A1D]">
                  {state.recommended.name}
                </p>
                <p className="mt-1 text-sm sm:text-base text-[#71646B] leading-relaxed">
                  {state.recommended.reason}
                </p>
                <button
                  onClick={() => practice(state.recommended.topic)}
                  className="mt-5 inline-flex cursor-pointer items-center rounded-xl bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-all duration-150 hover:bg-[#F43F5E] active:scale-[0.98]"
                >
                  Practice this topic &rarr;
                </button>
              </div>
            )}

            {/* Progress Over Time Chart */}
            <div className={card}>
              <h2 className="mb-4 text-xl font-semibold tracking-tight text-[#1F1A1D]">
                Progress over time
              </h2>
              <TrendChart history={state?.history ?? []} courseName={activeCourseName} />
            </div>

            {/* Reset Button */}
            <div className="text-right">
              <button
                onClick={reset}
                className="cursor-pointer text-xs text-[#A1939A] transition hover:text-[#E11D48] underline-offset-4 hover:underline"
              >
                Reset this student
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}