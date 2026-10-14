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
  slide: { label: "Slide", cls: "bg-pink-50 text-[#BE185D] border border-[#FBCFE8] hover:bg-pink-100/70" },
  book: { label: "Book", cls: "bg-rose-50 text-[#E11D48] border border-[#FECDD3] hover:bg-rose-100/70" },
  video: { label: "Video", cls: "bg-amber-50 text-[#C2410C] border border-[#FED7AA] hover:bg-amber-100/70" },
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
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition ${st.cls}`}
      title={c.snippet}
    >
      {showN && <span className="opacity-70 font-semibold">[{c.n}]</span>}
      {st.label} · {place(c)}
    </button>
  );
}

export function CitationChip({
  c,
  onOpen,
  showN = true,
}: {
  c: Citation;
  onOpen: (c: Citation) => void;
  showN?: boolean;
}) {
  const isSlide = c.source_type === "slide";
  const isBook = c.source_type === "book";
  const label = isSlide ? "Slide" : isBook ? "Book" : "Video";
  const borderCls = isSlide
    ? "border-[#FBCFE8] bg-[#FDF2F8] text-[#9D174D] hover:border-[#F472B6] hover:bg-[#FCE7F3]"
    : isBook
    ? "border-[#FECDD3] bg-[#FFF1F2] text-[#BE123C] hover:border-[#FB7185] hover:bg-[#FFE4E6]"
    : "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C] hover:border-[#FDBA74] hover:bg-[#FFEDD5]";

  return (
    <button
      onClick={() => onOpen(c)}
      title={c.snippet}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-[0.98] ${borderCls}`}
    >
      {isSlide && (
        <svg className="h-3 w-3 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      )}
      {isBook && (
        <svg className="h-3 w-3 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      )}
      {!isSlide && !isBook && (
        <svg className="h-3 w-3 opacity-80" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="6 4 18 12 6 20 6 4" />
        </svg>
      )}
      {showN && <span className="font-semibold opacity-70">[{c.n}]</span>}
      <span>{label} · {place(c)}</span>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4" onClick={onClose}>
      <div className="max-h-full w-full max-w-4xl overflow-auto rounded-2xl border border-[#F3D2DC] bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}>{st.label} · {place(c)}</span>
            {c.topic && <span className="text-xs text-[#71646B]">Topic: {c.topic}</span>}
          </div>
          <div className="flex items-center gap-3">
            {c.source_type === "video" && (
              <a href={youtubeLink(c)} target="_blank" rel="noreferrer" className="text-xs font-medium text-[#E11D48] hover:underline">
                Open on YouTube
              </a>
            )}
            <button onClick={onClose} className="rounded-lg px-2.5 py-1 text-sm text-[#71646B] hover:bg-[#FFF0F4] hover:text-[#1F1A1D]">Close</button>
          </div>
        </div>
        {c.source_type === "video" ? (
          <iframe src={mediaSrc(c)} className="aspect-video w-full rounded-lg border border-[#F3D2DC]" allow="autoplay; encrypted-media" allowFullScreen />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaSrc(c)} alt={`${st.label} ${place(c)}`} className="mx-auto max-h-[70vh] w-auto rounded-lg border border-[#F3D2DC]" />
        )}
        <p className="mt-3 rounded-lg border border-[#F3D2DC] bg-[#FFF0F4] p-3 text-xs text-[#71646B]">&ldquo;{c.snippet}&hellip;&rdquo;</p>
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

export type Course = {
  id: string;
  name: string;
  description?: string;
  created?: number;
  chunks_count?: number;
  sources_count?: number;
};

/** Course id kept in browser so course selection persists across pages and refreshes */
export function useCourse(defaultId: string = "default"): [string, (c: string) => void] {
  const [course, setCourseState] = useState(defaultId);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sw_active_course");
      if (saved) setCourseState(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const setCourse = (c: string) => {
    try {
      localStorage.setItem("sw_active_course", c);
    } catch {
      /* ignore */
    }
    setCourseState(c);
  };
  return [course, setCourse];
}

export const NAV_LINKS = [
  { href: "/", label: "Tutor chat" },
  { href: "/quiz", label: "Quiz" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/sources", label: "Sources" },
];

export function HeaderNav({
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
    <header className="sticky top-0 z-40 border-b border-[#F3D2DC] bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#FB7185] to-[#E11D48] text-white shadow-xs">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
          <div className="flex items-baseline">
            <span className="text-base font-semibold tracking-tight text-[#1F1A1D]">SourceWise</span>
            {subtitle && (
              <span className="ml-2.5 hidden border-l border-[#F3D2DC] pl-2.5 text-xs text-[#71646B] md:inline">
                {subtitle}
              </span>
            )}
          </div>
        </div>

        <nav className="flex items-center gap-1 rounded-full border border-[#F3D2DC] bg-[#FFF0F4] p-1 text-xs shadow-inner sm:text-sm">
          {NAV_LINKS.map((l) => {
            const active = path === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3.5 py-1 font-medium transition-all duration-150 ${
                  active
                    ? "bg-[#E11D48] text-white font-semibold shadow-xs"
                    : "text-[#71646B] hover:bg-white hover:text-[#1F1A1D]"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <label className="flex items-center gap-2 text-xs font-medium text-[#71646B]">
          <span className="text-[10px] uppercase tracking-[0.08em]">Student</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setStudent(draft)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="w-28 rounded-lg border border-[#F3D2DC] bg-white px-2.5 py-1 text-xs font-medium text-[#1F1A1D] outline-none transition focus:border-[#E11D48] focus:ring-1 focus:ring-[#E11D48]"
          />
        </label>
      </div>
    </header>
  );
}

export function getMasteryColor(p: number) {
  if (p >= 0.7) return "#E11D48";
  if (p >= 0.4) return "#F59E0B";
  return "#F43F5E";
}

export function masteryColor(p: number) {
  return p < 0.4 ? "bg-rose-400" : p < 0.7 ? "bg-amber-400" : "bg-[#E11D48]";
}