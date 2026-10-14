"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Citation = {
  n: number;
  source_type: "slide" | "book" | "video";
  location: string;
  loc_num: number;
  topic: string;
  snippet: string;
  url: string;
};
export type Topic = { topic: string; name: string; concepts?: string[]; p: number; n: number };
export type Recommended = { topic: string; name: string; reason: string };
export type LearnerState = {
  student: string;
  topics: Topic[];
  recommended: Recommended;
  history: { topic: string; p: number; source: string; ts: number }[];
};

export const TYPE_STYLE: Record<Citation["source_type"], { label: string; cls: string }> = {
  slide: { label: "Slide", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200 hover:bg-indigo-100" },
  book: { label: "Book", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100" },
  video: { label: "Video", cls: "bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100" },
};

export function place(c: Citation) {
  if (c.source_type === "video") {
    const m = Math.floor(c.loc_num / 60);
    const s = String(c.loc_num % 60).padStart(2, "0");
    return `${m}:${s}`;
  }
  if (c.source_type === "book") return `PDF page ${c.loc_num}`;
  return c.location.replace(/^./, (ch) => ch.toUpperCase());
}

export const mediaSrc = (c: Citation) => (c.url.startsWith("http") ? c.url : API + c.url);

function youtubeLink(c: Citation) {
  const u = new URL(c.url);
  const id = u.pathname.split("/").pop();
  return `https://www.youtube.com/watch?v=${id}&t=${u.searchParams.get("start") ?? 0}s`;
}

export function SourceChip({ c, onOpen, showN = true }: { c: Citation; onOpen: (c: Citation) => void; showN?: boolean }) {
  const st = TYPE_STYLE[c.source_type];
  return (
    <button
      onClick={() => onOpen(c)}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${st.cls}`}
      title={c.snippet}
    >
      {showN && <span className="opacity-60">[{c.n}]</span>}
      {st.label} · {place(c)}
    </button>
  );
}

export function Viewer({ c, onClose }: { c: Citation; onClose: () => void }) {
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

/** Student id kept in the browser so mastery persists; editable so you can demo a brand-new student. */
export function useStudent(): [string, (s: string) => void] {
  const [student, setStudentState] = useState("");
  useEffect(() => {
    let s = "";
    try {
      s = localStorage.getItem("sw_student") ?? "";
    } catch {
      /* storage unavailable */
    }
    if (!s) {
      s = "student-" + Math.random().toString(36).slice(2, 6);
      try {
        localStorage.setItem("sw_student", s);
      } catch {
        /* ignore */
      }
    }
    setStudentState(s);
  }, []);
  const setStudent = (s: string) => {
    const clean = s.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
    if (!clean) return;
    try {
      localStorage.setItem("sw_student", clean);
    } catch {
      /* ignore */
    }
    setStudentState(clean);
  };
  return [student, setStudent];
}

const LINKS = [
  { href: "/", label: "Tutor chat" },
  { href: "/quiz", label: "Quiz" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/sources", label: "Sources" },
];

export function Nav({ student, setStudent, subtitle }: { student: string; setStudent: (s: string) => void; subtitle?: string }) {
  const path = usePathname();
  const [draft, setDraft] = useState("");
  useEffect(() => setDraft(student), [student]);
  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500" />
          <div>
            <span className="text-lg font-semibold tracking-tight">SourceWise</span>
            {subtitle && <span className="ml-3 hidden text-xs text-slate-500 md:inline">{subtitle}</span>}
          </div>
        </div>
        <nav className="flex items-center gap-1 text-sm">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-1.5 font-medium transition ${path === l.href ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          Student
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setStudent(draft)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="w-28 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-800 outline-none focus:border-indigo-400"
          />
        </label>
      </div>
    </header>
  );
}

export function masteryColor(p: number) {
  return p < 0.4 ? "bg-rose-500" : p < 0.7 ? "bg-amber-500" : "bg-emerald-500";
}