"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API, HeaderNav, LearnerState, getMasteryColor, useStudent } from "../shared";

const pct = (p: number) => `${Math.round(p * 100)}%`;

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
      <div className="flex flex-col items-center justify-center rounded-xl border border-[#F3D2DC] bg-[#FFF0F4] py-10 text-center">
        <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#E11D48] border border-[#F3D2DC]">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        </div>
        <p className="text-sm font-medium text-[#1F1A1D]">No progress data yet</p>
        <p className="mt-0.5 text-xs text-[#71646B]">Take a quiz to see your progress over time.</p>
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
        Average mastery across topics: {pct(first)} at the start, <span className="font-semibold text-[#E11D48]">{pct(last)}</span> now ({pts.length - 1} updates).
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

  const card = "rounded-2xl border border-[#F3D2DC] bg-white p-6 sm:p-8 shadow-xs";
  const pts = state ? trend(state) : [];
  const overall = state ? state.topics.reduce((a, t) => a + t.p, 0) / Math.max(1, state.topics.length) : 0;
  const attempts = state ? state.topics.reduce((a, t) => a + t.n, 0) : 0;

  return (
    <div className="min-h-screen bg-[#FDF2F5] font-sans text-[#1F1A1D] selection:bg-[#E11D48]/20 selection:text-[#E11D48]">
      <HeaderNav student={student} setStudent={setStudent} subtitle="Mastery & knowledge tracing" />
      <main className="mx-auto max-w-[960px] space-y-6 px-4 sm:px-6 py-8">
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {state && (
          <>
            <div className={card}>
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#F3D2DC] pb-5">
                <div>
                  <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-[#1F1A1D] leading-tight">
                    Your mastery
                  </h1>
                  <p className="mt-1 text-xs sm:text-sm text-[#71646B]">
                    {attempts} graded answers so far
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-3xl sm:text-4xl font-semibold text-[#E11D48] tracking-tight">
                    {pct(overall)}
                  </p>
                  <p className="text-xs text-[#71646B]">average across topics</p>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                {state.topics.map((t) => (
                  <div key={t.topic}>
                    <div className="mb-1.5 flex items-baseline justify-between text-sm">
                      <span className="font-medium text-[#1F1A1D]">{t.name}</span>
                      <span className="text-sm font-semibold text-[#1F1A1D]">
                        {pct(t.p)}{" "}
                        <span className="text-xs font-normal text-[#71646B]">· {t.n} answers</span>
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#FFE4E6]">
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
                Practice this topic
              </button>
            </div>

            <div className={card}>
              <h2 className="mb-4 text-xl font-semibold tracking-tight text-[#1F1A1D]">
                Progress over time
              </h2>
              <TrendChart pts={pts} />
            </div>

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