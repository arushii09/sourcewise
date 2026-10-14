"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { API, Citation, Course, HeaderNav, LearnerState, Viewer, CitationChip, useCourse, useStudent } from "./shared";

type Msg = { role: "user" | "assistant"; text: string; grounded?: boolean; citations?: Citation[] };

function AnswerText({ text, citations, onOpen }: { text: string; citations: Citation[]; onOpen: (c: Citation) => void }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p className="whitespace-pre-wrap text-sm sm:text-base leading-relaxed text-[#1F1A1D]">
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\]$/);
        const c = m ? citations.find((x) => x.n === Number(m[1])) : undefined;
        if (!c) return <span key={i}>{p}</span>;
        return (
          <button
            key={i}
            onClick={() => onOpen(c)}
            className="mx-0.5 inline-flex cursor-pointer items-center rounded border border-[#FECDD3] bg-[#FFF1F2] px-1.5 py-0.5 align-baseline text-[11px] font-semibold text-[#E11D48] transition hover:bg-[#FFE4E6]"
          >
            {c.n}
          </button>
        );
      })}
    </p>
  );
}

export default function Home() {
  const [student, setStudent] = useStudent();
  const [selectedCourseId, setSelectedCourseId] = useCourse("default");
  const [coursesList, setCoursesList] = useState<Course[]>([]);
  const [starters, setStarters] = useState<string[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [viewer, setViewer] = useState<Citation | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Load available courses
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

  useEffect(() => {
    if (!student) return;
    fetch(`${API}/learner/${student}`)
      .then((r) => r.json())
      .then((d: LearnerState) => setStarters(d.topics.slice(0, 4).map((t) => `Explain: ${t.name}`)))
      .catch(() => {});
  }, [student]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const activeCourse = coursesList.find((c) => c.id === selectedCourseId);
  const activeCourseChunks = selectedCourseId === "all"
    ? coursesList.reduce((acc, c) => acc + (c.chunks_count || 0), 0)
    : activeCourse?.chunks_count ?? 0;

  async function send(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    try {
      const r = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          student,
          course: selectedCourseId === "all" ? undefined : selectedCourseId,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setMessages((m) => [...m, { role: "assistant", text: d.answer, grounded: d.grounded, citations: d.citations }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "I couldn't reach the backend. Is the server running on port 8000?", grounded: false, citations: [] },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FDF2F5] font-sans text-[#1F1A1D] selection:bg-[#E11D48]/20 selection:text-[#E11D48]">
      <HeaderNav
        student={student}
        setStudent={setStudent}
        subtitle="Course-grounded AI tutoring"
      />

      {/* Dynamic Course Toolbar */}
      <div className="border-b border-[#F3D2DC] bg-white/80 backdrop-blur-xs px-4 py-2 sm:px-6">
        <div className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-[#F3D2DC] bg-[#FFF0F4] text-[#E11D48]">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <span className="font-semibold text-[#71646B]">Course:</span>
            <select
              value={selectedCourseId}
              onChange={(e) => {
                setSelectedCourseId(e.target.value);
              }}
              className="cursor-pointer rounded-lg border border-[#F3D2DC] bg-[#FFF0F4] px-2.5 py-1 text-xs font-semibold text-[#1F1A1D] outline-none transition focus:border-[#E11D48] shadow-2xs"
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
      </div>

      <main className="mx-auto flex h-[calc(100vh-105px)] w-full max-w-[960px] flex-col px-4 sm:px-6">
        <div className="flex-1 space-y-6 overflow-y-auto py-6 pr-1">
          {messages.length === 0 && (
            activeCourseChunks === 0 && selectedCourseId !== "all" ? (
              /* Empty state when selected course has 0 sources */
              <div className="my-auto flex h-full flex-col items-center justify-center py-12 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-700 shadow-2xs">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#1F1A1D]">
                  No sources indexed for {activeCourse?.name || "this course"}
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-[#71646B] leading-relaxed">
                  This course doesn&apos;t have any learning materials yet. Upload lecture slides, a textbook PDF, or add a YouTube video to enable course-grounded AI tutoring.
                </p>
                <Link
                  href="/sources"
                  className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-[#F43F5E] active:scale-[0.98]"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add sources to this course
                </Link>
              </div>
            ) : (
              /* Normal welcome state */
              <div className="my-auto flex h-full flex-col items-center justify-center py-12 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] text-[#E11D48] shadow-2xs">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-[#1F1A1D] leading-tight">
                  Ask about {activeCourse ? activeCourse.name : "your course material"}
                </h1>
                <p className="mx-auto mt-2.5 max-w-lg text-sm sm:text-base text-[#71646B] leading-relaxed">
                  Every answer cites the exact slide, book page, or video moment from this course. Questions the material doesn&apos;t cover are declined.
                </p>
                {starters.length > 0 && (
                  <div className="mt-8 flex max-w-xl flex-wrap justify-center gap-2.5">
                    {starters.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="cursor-pointer rounded-full border border-[#F3D2DC] bg-white px-4 py-2 text-sm text-[#1F1A1D] shadow-2xs transition-all duration-150 hover:border-[#E11D48]/40 hover:bg-[#FFF0F4] hover:text-[#E11D48] active:scale-[0.98]"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] sm:max-w-[78%] rounded-2xl rounded-br-xs border border-[#FECDD3] bg-[#FFF1F2] px-4.5 py-3 sm:px-5 sm:py-3.5 text-sm sm:text-base leading-relaxed text-[#1F1A1D] shadow-2xs">
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div
                  className={`max-w-[92%] sm:max-w-[85%] rounded-2xl rounded-bl-xs border p-5 sm:p-6 shadow-xs ${
                    m.grounded === false
                      ? "border-amber-200 bg-amber-50"
                      : "border-[#F3D2DC] bg-white"
                  }`}
                >
                  {m.grounded === false && (
                    <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-amber-800">
                      Not covered by {activeCourse ? activeCourse.name : "course material"}
                    </div>
                  )}
                  <AnswerText text={m.text} citations={m.citations ?? []} onOpen={setViewer} />
                  {m.citations && m.citations.length > 0 && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#F3D2DC] pt-3.5">
                      <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#71646B]">
                        Sources
                      </span>
                      {m.citations.map((c) => (
                        <CitationChip key={c.n} c={c} onOpen={setViewer} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          )}

          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2.5 rounded-2xl rounded-bl-xs border border-[#F3D2DC] bg-white px-5 py-3.5 text-sm text-[#71646B] shadow-xs">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#E11D48]" />
                Searching {activeCourse ? activeCourse.name : "course material"}&hellip;
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="pb-5 pt-2">
          <div className="flex items-center gap-2 rounded-full border border-[#F3D2DC] bg-white p-2 shadow-sm transition-all duration-150 focus-within:border-[#E11D48] focus-within:ring-2 focus-within:ring-[#E11D48]/15">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
              placeholder={`Ask a question about ${activeCourse ? activeCourse.name : "the course material"}...`}
              className="flex-1 bg-transparent px-4 py-2 text-sm sm:text-base text-[#1F1A1D] outline-none placeholder:text-[#A1939A]"
            />
            <button
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              className="cursor-pointer rounded-full bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-all duration-150 hover:bg-[#F43F5E] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
            >
              Ask
            </button>
          </div>
        </div>
      </main>

      {viewer && <Viewer c={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}