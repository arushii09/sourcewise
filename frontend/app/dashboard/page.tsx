"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API, LearnerState, useStudent } from "../shared";

const pct = (p: number) => `${Math.round(p * 100)}%`;

function getMasteryColor(p: number) {
  if (p >= 0.7) return "#2F7D5B";
  if (p >= 0.4) return "#D9A441";
  return "#D1703F";
}

const NAV_LINKS = [
  { href: "/", label: "Tutor chat" },
  { href: "/quiz", label: "Quiz" },
  { href: "/dashboard", label: "Dashboard" },
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

function trend(state: LearnerState): number[] {
  const cur: Record<string, number> = {};
  state.topics.forEach((t) => (cur[t.topic] = 0.3));
  const avg = () => {
    const v = Object.values(cur);
    return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  };
  const pts = [avg()];
  state.history.forEach((h) => {
    cur[h.topic] = h.p;
    pts.push(avg());
  });
  return pts;
}

function TrendChart({ pts }: { pts: number[] }) {
  if (pts.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF0EA] text-[#6B7280]">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        </div>
        <p className="text-sm font-medium text-[#1C1C1A]">No progress data yet</p>
        <p className="mt-0.5 text-xs text-[#6B7280]">Take a quiz to see your progress over time.</p>
      </div>
    );
  }
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
            <line x1={L} x2={W - 12} y1={y(g)} y2={y(g)} stroke="#E7E5DE" strokeDasharray="4 4" />
            <text x={L - 6} y={y(g) + 4} textAnchor="end" fontSize="11" fill="#6B7280">{pct(g)}</text>
          </g>
        ))}
        <polyline points={line} fill="none" stroke="#2F7D5B" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p)}
            r={i === pts.length - 1 ? 4.5 : i === 0 ? 3.5 : 2.5}
            fill={i === pts.length - 1 ? "#1F4D3A" : i === 0 ? "#9CA3AF" : "#2F7D5B"}
          />
        ))}
      </svg>
      <p className="mt-2.5 text-xs text-[#6B7280]">
        Average mastery across topics: {pct(first)} at the start, {pct(last)} now ({pts.length - 1} updates).
      </p>
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [student, setStudent] = useStudent();
  const [state, setState] = useState<LearnerState | null>(null);
  const [error, setError] = useState("");

  function load() {
    if (!student) return;
    fetch(`${API}/learner/${student}`)
      .then((r) => r.json())
      .then(setState)
      .catch(() => setError("Could not reach the backend. Is the server running on port 8000?"));
  }
  useEffect(load, [student]);

  async function reset() {
    if (!confirm(`Reset all progress for "${student}"?`)) return;
    await fetch(`${API}/learner/${student}`, { method: "DELETE" });
    load();
  }

  function practice(topic: string) {
    try {
      sessionStorage.setItem("sw_quiz_topic", topic);
    } catch {
      /* ignore */
    }
    router.push("/quiz");
  }

  const card = "rounded-2xl border border-[#E7E5DE] bg-white p-6 sm:p-8 shadow-xs";
  const pts = state ? trend(state) : [];
  const overall = state ? state.topics.reduce((a, t) => a + t.p, 0) / Math.max(1, state.topics.length) : 0;
  const attempts = state ? state.topics.reduce((a, t) => a + t.n, 0) : 0;

  return (
    <div className="min-h-screen bg-[#FAFAF7] font-sans text-[#1C1C1A] selection:bg-[#E8F0E4] selection:text-[#1F4D3A]">
      <HeaderNav student={student} setStudent={setStudent} />
      <main className="mx-auto max-w-[960px] space-y-6 px-4 sm:px-6 py-8">
        {error && (
          <div className="rounded-2xl border border-[#F5C2B3] bg-[#FCF0EC] p-4 text-sm text-[#A83D24]">
            {error}
          </div>
        )}

        {state && (
          <>
            <div className={card}>
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#F0EFEA] pb-5">
                <div>
                  <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-[#1C1C1A] leading-tight">
                    Your mastery
                  </h1>
                  <p className="mt-1 text-xs sm:text-sm text-[#6B7280]">
                    {attempts} graded answers so far
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-3xl sm:text-4xl font-semibold text-[#1F4D3A] tracking-tight">
                    {pct(overall)}
                  </p>
                  <p className="text-xs text-[#6B7280]">average across topics</p>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                {state.topics.map((t) => (
                  <div key={t.topic}>
                    <div className="mb-1.5 flex items-baseline justify-between text-sm">
                      <span className="font-medium text-[#1C1C1A]">{t.name}</span>
                      <span className="text-sm font-semibold text-[#1C1C1A]">
                        {pct(t.p)}{" "}
                        <span className="text-xs font-normal text-[#6B7280]">· {t.n} answers</span>
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#EEF0EA]">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: pct(t.p),
                          backgroundColor: getMasteryColor(t.p),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[#D5E4D0] bg-[#E8F0E4] p-6 sm:p-8 shadow-2xs">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#1F4D3A]">
                RECOMMENDED NEXT
              </p>
              <p className="mt-2 text-xl sm:text-2xl font-semibold tracking-tight text-[#1C1C1A]">
                {state.recommended.name}
              </p>
              <p className="mt-1 text-sm sm:text-base text-[#4A5568] leading-relaxed">
                {state.recommended.reason}
              </p>
              <button
                onClick={() => practice(state.recommended.topic)}
                className="mt-5 inline-flex cursor-pointer items-center rounded-xl bg-[#1F4D3A] px-5 py-2.5 text-sm font-medium text-white shadow-xs transition-all duration-150 hover:bg-[#285E47] active:scale-[0.98]"
              >
                Practice this topic
              </button>
            </div>

            <div className={card}>
              <h2 className="mb-4 text-xl font-semibold tracking-tight text-[#1C1C1A]">
                Progress over time
              </h2>
              <TrendChart pts={pts} />
            </div>

            <div className="text-right">
              <button
                onClick={reset}
                className="cursor-pointer text-xs text-[#9CA3AF] transition hover:text-[#D1703F] underline-offset-4 hover:underline"
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