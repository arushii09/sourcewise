"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { API, Citation, LearnerState, Viewer, place, useStudent } from "./shared";

type Msg = { role: "user" | "assistant"; text: string; grounded?: boolean; citations?: Citation[] };

const NAV_LINKS = [
  { href: "/", label: "Tutor chat" },
  { href: "/quiz", label: "Quiz" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/sources", label: "Sources" },
];

function HeaderNav({
  student,
  setStudent,
  subtitle,
}: {
  student: string;
  setStudent: (s: string) => void;
  subtitle?: string;
}) {
  const path = usePathname();
  const [draft, setDraft] = useState("");
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setDraft(student), [student]);

  return (
    <header className="sticky top-0 z-40 border-b border-[#E7E5DE] bg-[#FAFAF7]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#1F4D3A] text-white shadow-xs">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
          <div className="flex items-baseline">
            <span className="text-base font-semibold tracking-tight text-[#1C1C1A]">SourceWise</span>
            {subtitle && (
              <span className="ml-2.5 hidden border-l border-[#E7E5DE] pl-2.5 text-xs text-[#6B7280] md:inline">
                {subtitle}
              </span>
            )}
          </div>
        </div>

        <nav className="flex items-center gap-1 rounded-full border border-[#E7E5DE] bg-white p-1 text-xs shadow-2xs sm:text-sm">
          {NAV_LINKS.map((l) => {
            const active = path === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3 py-1 font-medium transition-all duration-150 ${active
                    ? "bg-[#1F4D3A] text-white shadow-xs"
                    : "text-[#6B7280] hover:bg-[#E8F0E4]/60 hover:text-[#1C1C1A]"
                  }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <label className="flex items-center gap-2 text-xs font-medium text-[#6B7280]">
          <span className="text-[10px] uppercase tracking-[0.08em]">Student</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setStudent(draft)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="w-28 rounded-lg border border-[#E7E5DE] bg-white px-2.5 py-1 text-xs font-medium text-[#1C1C1A] outline-none transition focus:border-[#1F4D3A] focus:ring-2 focus:ring-[#1F4D3A]/15 shadow-2xs"
          />
        </label>
      </div>
    </header>
  );
}

function CitationChip({
  c,
  onOpen,
  showN = true,
}: {
  c: Citation;
  onOpen: (c: Citation) => void;
  showN?: boolean;
}) {
  const label = c.source_type === "slide" ? "Slide" : c.source_type === "book" ? "Book" : "Video";
  return (
    <button
      onClick={() => onOpen(c)}
      title={c.snippet}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#D5E4D0] bg-[#E8F0E4] px-2.5 py-1 text-xs font-medium text-[#1F4D3A] transition-all duration-150 hover:border-[#C6DAC0] hover:bg-[#DCE9D7] hover:shadow-2xs active:scale-[0.98]"
    >
      {c.source_type === "slide" && (
        <svg className="h-3 w-3 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      )}
      {c.source_type === "book" && (
        <svg className="h-3 w-3 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      )}
      {c.source_type === "video" && (
        <svg className="h-3 w-3 opacity-70" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="6 4 18 12 6 20 6 4" />
        </svg>
      )}
      {showN && <span className="font-semibold opacity-70">[{c.n}]</span>}
      <span>{label} · {place(c)}</span>
    </button>
  );
}

function AnswerText({ text, citations, onOpen }: { text: string; citations: Citation[]; onOpen: (c: Citation) => void }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p className="whitespace-pre-wrap text-sm sm:text-base leading-relaxed text-[#1C1C1A]">
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\]$/);
        const c = m ? citations.find((x) => x.n === Number(m[1])) : undefined;
        if (!c) return <span key={i}>{p}</span>;
        return (
          <button
            key={i}
            onClick={() => onOpen(c)}
            className="mx-0.5 inline-flex cursor-pointer items-center rounded border border-[#D5E4D0] bg-[#E8F0E4] px-1.5 py-0.5 align-baseline text-[11px] font-semibold text-[#1F4D3A] transition hover:bg-[#DCE9D7]"
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
  const [course, setCourse] = useState("");
  const [starters, setStarters] = useState<string[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [viewer, setViewer] = useState<Citation | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.json())
      .then((d) => setCourse(d.course ?? ""))
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (!student) return;
    fetch(`${API}/learner/${student}`)
      .then((r) => r.json())
      .then((d: LearnerState) => setStarters(d.topics.slice(0, 4).map((t) => `Explain: ${t.name}`)))
      .catch(() => { });
  }, [student]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

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
        body: JSON.stringify({ question, student }),
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
    <div className="flex min-h-screen flex-col bg-[#FAFAF7] font-sans text-[#1C1C1A] selection:bg-[#E8F0E4] selection:text-[#1F4D3A]">
      <HeaderNav student={student} setStudent={setStudent} subtitle={course ? `Grounded in: ${course}` : undefined} />

      <main className="mx-auto flex h-[calc(100vh-65px)] w-full max-w-[960px] flex-col px-4 sm:px-6">
        <div className="flex-1 space-y-6 overflow-y-auto py-6 pr-1">
          {messages.length === 0 && (
            <div className="my-auto flex h-full flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#D5E4D0] bg-[#E8F0E4] text-[#1F4D3A] shadow-2xs">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-[#1C1C1A] leading-tight">
                Ask about your course material
              </h1>
              <p className="mx-auto mt-2.5 max-w-lg text-sm sm:text-base text-[#6B7280] leading-relaxed">
                Every answer cites the exact slide, book page or video moment. Questions the material doesn&apos;t cover are declined.
              </p>
              {starters.length > 0 && (
                <div className="mt-8 flex max-w-xl flex-wrap justify-center gap-2.5">
                  {starters.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="cursor-pointer rounded-full border border-[#E7E5DE] bg-white px-4 py-2 text-sm text-[#1C1C1A] shadow-2xs transition-all duration-150 hover:border-[#C6DAC0] hover:bg-[#E8F0E4] hover:text-[#1F4D3A] active:scale-[0.98]"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] sm:max-w-[78%] rounded-2xl rounded-br-xs border border-[#D5E4D0] bg-[#E8F0E4] px-4.5 py-3 sm:px-5 sm:py-3.5 text-sm sm:text-base leading-relaxed text-[#1C1C1A] shadow-2xs">
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div
                  className={`max-w-[92%] sm:max-w-[85%] rounded-2xl rounded-bl-xs border p-5 sm:p-6 shadow-xs ${m.grounded === false
                      ? "border-[#F0D59F] bg-[#FCF8EE]"
                      : "border-[#E7E5DE] bg-white"
                    }`}
                >
                  {m.grounded === false && (
                    <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[#EAC986] bg-[#F7ECCF] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#8F5E16]">
                      Not covered by the course material
                    </div>
                  )}
                  <AnswerText text={m.text} citations={m.citations ?? []} onOpen={setViewer} />
                  {m.citations && m.citations.length > 0 && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#F0EFEA] pt-3.5">
                      <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
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
              <div className="flex items-center gap-2.5 rounded-2xl rounded-bl-xs border border-[#E7E5DE] bg-white px-5 py-3.5 text-sm text-[#6B7280] shadow-xs">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#2F7D5B]" />
                Searching the course material&hellip;
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="pb-5 pt-2">
          <div className="flex items-center gap-2 rounded-full border border-[#E7E5DE] bg-white p-2 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-150 focus-within:border-[#1F4D3A] focus-within:ring-2 focus-within:ring-[#1F4D3A]/15">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
              placeholder="Ask a question about the course material..."
              className="flex-1 bg-transparent px-4 py-2 text-sm sm:text-base text-[#1C1C1A] outline-none placeholder:text-[#9CA3AF]"
            />
            <button
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              className="cursor-pointer rounded-full bg-[#1F4D3A] px-5 py-2.5 text-sm font-medium text-white shadow-xs transition-all duration-150 hover:bg-[#285E47] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-[#1F4D3A]"
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