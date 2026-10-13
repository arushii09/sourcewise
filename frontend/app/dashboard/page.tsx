"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API, LearnerState, Nav, masteryColor, useStudent } from "../shared";

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
    return <p className="text-sm text-slate-500">Take a quiz to see your progress over time.</p>;
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
            <line x1={L} x2={W - 12} y1={y(g)} y2={y(g)} stroke="#e2e8f0" strokeDasharray="4 4" />
            <text x={L - 6} y={y(g) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{pct(g)}</text>
          </g>
        ))}
        <polyline points={line} fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(0)} cy={y(first)} r="3.5" fill="#94a3b8" />
        <circle cx={x(pts.length - 1)} cy={y(last)} r="4.5" fill="#4f46e5" />
      </svg>
      <p className="mt-1 text-xs text-slate-500">
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  const pts = state ? trend(state) : [];
  const overall = state ? state.topics.reduce((a, t) => a + t.p, 0) / Math.max(1, state.topics.length) : 0;
  const attempts = state ? state.topics.reduce((a, t) => a + t.n, 0) : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Nav student={student} setStudent={setStudent} />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

        {state && (
          <>
            <div className={card}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">Your mastery</h1>
                  <p className="text-sm text-slate-500">{attempts} graded answers so far</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-semibold text-indigo-700">{pct(overall)}</p>
                  <p className="text-xs text-slate-500">average across topics</p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {state.topics.map((t) => (
                  <div key={t.topic}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-slate-500">
                        {pct(t.p)} <span className="text-xs text-slate-400">· {t.n} answers</span>
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full transition-all ${masteryColor(t.p)}`} style={{ width: pct(t.p) }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Recommended next</p>
              <p className="mt-1 text-lg font-semibold text-indigo-900">{state.recommended.name}</p>
              <p className="text-sm text-indigo-800/80">{state.recommended.reason}</p>
              <button onClick={() => practice(state.recommended.topic)} className="mt-3 rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700">
                Practice this topic
              </button>
            </div>

            <div className={card}>
              <h2 className="mb-2 font-semibold">Progress over time</h2>
              <TrendChart pts={pts} />
            </div>

            <div className="text-right">
              <button onClick={reset} className="text-xs text-slate-400 hover:text-rose-600">
                Reset this student
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}