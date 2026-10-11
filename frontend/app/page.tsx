"use client";

import { useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Citation = {
  n: number;
  source_type: "slide" | "book" | "video";
  location: string;
  loc_num: number;
  topic: string;
  snippet: string;
  url: string;
};
type Msg = { role: "user" | "assistant"; text: string; grounded?: boolean; citations?: Citation[] };

const STARTERS = [
  "What is a base case in recursion?",
  "How does memoization speed up Fibonacci?",
  "How do I loop over a dictionary's keys?",
  "Explain the Towers of Hanoi solution",
];

const TYPE_STYLE: Record<Citation["source_type"], { label: string; cls: string }> = {
  slide: { label: "Slide", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200 hover:bg-indigo-100" },
  book: { label: "Book", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100" },
  video: { label: "Video", cls: "bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100" },
};

function place(c: Citation) {
  if (c.source_type === "video") {
    const m = Math.floor(c.loc_num / 60);
    const s = String(c.loc_num % 60).padStart(2, "0");
    return `${m}:${s}`;
  }
  if (c.source_type === "book") return `PDF page ${c.loc_num}`;
  return c.location.replace(/^./, (ch) => ch.toUpperCase());
}

const mediaSrc = (c: Citation) => (c.url.startsWith("http") ? c.url : API + c.url);

function youtubeLink(c: Citation) {
  const u = new URL(c.url);
  const id = u.pathname.split("/").pop();
  return `https://www.youtube.com/watch?v=${id}&t=${u.searchParams.get("start") ?? 0}s`;
}

function SourceChip({ c, onOpen }: { c: Citation; onOpen: (c: Citation) => void }) {
  const st = TYPE_STYLE[c.source_type];
  return (
    <button
      onClick={() => onOpen(c)}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${st.cls}`}
      title={c.snippet}
    >
      <span className="opacity-60">[{c.n}]</span>
      {st.label} · {place(c)}
    </button>
  );
}

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

function Viewer({ c, onClose }: { c: Citation; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const st = TYPE_STYLE[c.source_type];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div className="max-h-full w-full max-w-4xl overflow-auto rounded-2xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${st.cls}`}>{st.label} · {place(c)}</span>
            {c.topic && <span className="text-xs text-slate-500">Topic: {c.topic}</span>}
          </div>
          <div className="flex items-center gap-3">
            {c.source_type === "video" && (
              <a href={youtubeLink(c)} target="_blank" rel="noreferrer" className="text-xs font-medium text-indigo-600 hover:underline">
                Open on YouTube
              </a>
            )}
            <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">Close</button>
          </div>
        </div>
        {c.source_type === "video" ? (
          <iframe src={mediaSrc(c)} className="aspect-video w-full rounded-lg" allow="autoplay; encrypted-media" allowFullScreen />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaSrc(c)} alt={`${st.label} ${place(c)}`} className="mx-auto max-h-[70vh] w-auto rounded-lg border border-slate-200" />
        )}
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">&ldquo;{c.snippet}&hellip;&rdquo;</p>
      </div>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [viewer, setViewer] = useState<Citation | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

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
        body: JSON.stringify({ question }),
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
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500" />
            <span className="text-lg font-semibold tracking-tight">SourceWise</span>
          </div>
          <span className="hidden text-xs text-slate-500 sm:block">Grounded in MIT 6.0001 Lecture 6 + Think Python</span>
        </div>
      </header>

      <main className="mx-auto flex h-[calc(100vh-57px)] max-w-3xl flex-col px-4">
        <div className="flex-1 space-y-5 overflow-y-auto py-6">
          {messages.length === 0 && (
            <div className="mt-10 text-center">
              <h1 className="text-2xl font-semibold tracking-tight">Ask about recursion and dictionaries</h1>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                Every answer cites the exact slide, book page or video moment. Questions the material doesn&apos;t cover are declined.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
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