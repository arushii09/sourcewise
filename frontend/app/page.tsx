"use client";

import { useEffect, useRef, useState } from "react";
import { API, Citation, LearnerState, Nav, SourceChip, Viewer, useStudent } from "./shared";

type Msg = { role: "user" | "assistant"; text: string; grounded?: boolean; citations?: Citation[] };

function AnswerText({ text, citations, onOpen }: { text: string; citations: Citation[]; onOpen: (c: Citation) => void }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p className="whitespace-pre-wrap leading-relaxed">
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\]$/);
        const c = m ? citations.find((x) => x.n === Number(m[1])) : undefined;
        if (!c) return <span key={i}>{p}</span>;
        return (
          <button
            key={i}
            onClick={() => onOpen(c)}
            className="mx-0.5 rounded bg-indigo-100 px-1 align-baseline text-[11px] font-semibold text-indigo-700 hover:bg-indigo-200"
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
      .catch(() => {});
  }, []);

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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Nav student={student} setStudent={setStudent} subtitle={course ? `Grounded in: ${course}` : undefined} />

      <main className="mx-auto flex h-[calc(100vh-65px)] max-w-3xl flex-col px-4">
        <div className="flex-1 space-y-5 overflow-y-auto py-6">
          {messages.length === 0 && (
            <div className="mt-10 text-center">
              <h1 className="text-2xl font-semibold tracking-tight">Ask about your course material</h1>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                Every answer cites the exact slide, book page or video moment. Questions the material doesn&apos;t cover are declined.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {starters.map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-sm text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-700">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-white shadow-sm">{m.text}</div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className={`max-w-[92%] rounded-2xl rounded-bl-md border bg-white px-4 py-3 shadow-sm ${m.grounded ? "border-slate-200" : "border-amber-300 bg-amber-50"}`}>
                  {m.grounded === false && (
                    <span className="mb-1.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      Not covered by the course material
                    </span>
                  )}
                  <AnswerText text={m.text} citations={m.citations ?? []} onOpen={setViewer} />
                  {m.citations && m.citations.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                      <span className="mr-1 self-center text-[11px] font-medium uppercase tracking-wide text-slate-400">Sources</span>
                      {m.citations.map((c) => (
                        <SourceChip key={c.n} c={c} onOpen={setViewer} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          )}

          {loading && (
            <div className="flex justify-start">
              <div className="animate-pulse rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-400">Searching the course material&hellip;</div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="pb-5">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm focus-within:border-indigo-400">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
              placeholder="Ask a question about the course material..."
              className="flex-1 bg-transparent px-3 py-2 text-slate-900 outline-none placeholder:text-slate-400"
            />
            <button
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
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