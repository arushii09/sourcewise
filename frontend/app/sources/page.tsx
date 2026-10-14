"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { API, useStudent } from "../shared";

type SourceItem = {
  id: string;
  name: string;
  type: "slide" | "book" | "video" | string;
  chunks: number;
  uploaded: boolean;
};

type JobStage = "queued" | "extracting" | "embedding" | "indexing" | "done";

type JobInfo = {
  jobId: string;
  status: "running" | "done" | "error";
  stage: JobStage | string;
  chunks?: number;
  error?: string | null;
  note?: string | null;
  sourceName: string;
  sourceType: "pdf" | "youtube";
};

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
                className={`rounded-full px-3 py-1 font-medium transition-all duration-150 ${
                  active
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

function SourceTypeBadge({ type }: { type: string }) {
  if (type === "slide") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
        <svg className="h-3 w-3 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        Slide
      </span>
    );
  }
  if (type === "book") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E4D0] bg-[#E8F0E4] px-2.5 py-0.5 text-xs font-medium text-[#1F4D3A]">
        <svg className="h-3 w-3 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        Book
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700">
      <svg className="h-3 w-3 opacity-80" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="6 4 18 12 6 20 6 4" />
      </svg>
      Video
    </span>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STAGES: { key: JobStage; label: string; desc: string }[] = [
  { key: "extracting", label: "Extracting text", desc: "Extracting pages & captions" },
  { key: "embedding", label: "Generating embeddings", desc: "Computing semantic embeddings" },
  { key: "indexing", label: "Indexing to database", desc: "Writing chunks to vector store" },
  { key: "done", label: "Ready", desc: "Available for chat & quiz" },
];

function getStageIndex(stage: string): number {
  if (stage === "queued") return 0;
  if (stage === "extracting") return 0;
  if (stage === "embedding") return 1;
  if (stage === "indexing") return 2;
  if (stage === "done") return 3;
  return 0;
}

export default function SourcesPage() {
  const [student, setStudent] = useStudent();

  // Sources list state
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Upload PDF card state
  const [kind, setKind] = useState<"slides" | "book">("slides");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // YouTube card state
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [isAddingYoutube, setIsAddingYoutube] = useState(false);

  // Active / Last Job state
  const [activeJob, setActiveJob] = useState<JobInfo | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const cardStyle = "rounded-2xl border border-[#E7E5DE] bg-white p-6 sm:p-8 shadow-xs";

  // Fetch sources list from GET /sources
  const loadSources = useCallback(async () => {
    try {
      setSourcesError(null);
      const res = await fetch(`${API}/sources`);
      if (!res.ok) {
        throw new Error(`Failed to load sources (${res.status})`);
      }
      const data: SourceItem[] = await res.json();
      setSources(data);
    } catch (err: any) {
      setSourcesError(err.message || "Failed to fetch sources from backend.");
    } finally {
      setIsLoadingSources(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  // Clean up polling timer on unmount
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // Poll job status every 1.5s
  const startPolling = useCallback(
    (jobId: string, sourceName: string, sourceType: "pdf" | "youtube") => {
      stopPolling();
      setActiveJob({
        jobId,
        status: "running",
        stage: "queued",
        sourceName,
        sourceType,
      });

      pollTimerRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API}/sources/jobs/${jobId}`);
          if (!res.ok) {
            throw new Error(`Failed to check job (${res.status})`);
          }
          const data = await res.json();

          setActiveJob((prev) => ({
            jobId,
            status: data.status,
            stage: data.stage || "running",
            chunks: data.chunks,
            error: data.error,
            note: data.note,
            sourceName: prev?.sourceName || sourceName,
            sourceType: prev?.sourceType || sourceType,
          }));

          if (data.status === "done") {
            stopPolling();
            loadSources();
          } else if (data.status === "error") {
            stopPolling();
          }
        } catch (err: any) {
          stopPolling();
          setActiveJob((prev) => ({
            jobId,
            status: "error",
            stage: "error",
            error: err.message || "Lost connection to the job runner",
            sourceName: prev?.sourceName || sourceName,
            sourceType: prev?.sourceType || sourceType,
          }));
        }
      }, 1500);
    },
    [loadSources, stopPolling]
  );

  // Handle PDF file select
  const handleFileChange = (file: File | null) => {
    setPdfError(null);
    if (!file) {
      setPdfFile(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setPdfError("Please select a valid PDF file.");
      setPdfFile(null);
      return;
    }
    if (file.size > 40 * 1024 * 1024) {
      setPdfError("File exceeds the 40 MB size limit.");
      setPdfFile(null);
      return;
    }
    setPdfFile(file);
  };

  // Submit PDF upload
  const handleUploadPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pdfFile) {
      setPdfError("Please select a PDF file first.");
      return;
    }

    setIsUploadingPdf(true);
    setPdfError(null);

    try {
      const formData = new FormData();
      formData.append("file", pdfFile);
      formData.append("kind", kind);

      const res = await fetch(`${API}/sources/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || `Upload failed with status ${res.status}`);
      }

      const { job_id } = await res.json();
      const fileName = pdfFile.name;
      setPdfFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      startPolling(job_id, fileName, "pdf");
    } catch (err: any) {
      setPdfError(err.message || "An error occurred while uploading the file.");
    } finally {
      setIsUploadingPdf(false);
    }
  };

  // Submit YouTube URL
  const handleAddYoutube = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = youtubeUrl.trim();
    if (!url) {
      setYoutubeError("Please enter a YouTube video URL.");
      return;
    }

    setIsAddingYoutube(true);
    setYoutubeError(null);

    try {
      const res = await fetch(`${API}/sources/youtube`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || `Failed with status ${res.status}`);
      }

      const { job_id } = await res.json();
      setYoutubeUrl("");
      startPolling(job_id, url, "youtube");
    } catch (err: any) {
      setYoutubeError(err.message || "An error occurred while adding the YouTube video.");
    } finally {
      setIsAddingYoutube(false);
    }
  };

  const isJobRunning = activeJob?.status === "running";
  const stageIdx = activeJob ? getStageIndex(activeJob.stage) : 0;

  const filteredSources = sources.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalChunks = sources.reduce((acc, s) => acc + (s.chunks || 0), 0);

  return (
    <div className="min-h-screen bg-[#FAFAF7] font-sans text-[#1C1C1A] selection:bg-[#E8F0E4] selection:text-[#1F4D3A]">
      <HeaderNav student={student} setStudent={setStudent} subtitle="Knowledge Base" />

      <main className="mx-auto max-w-[960px] space-y-6 px-4 sm:px-6 py-8">
        {/* Page Title */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#F0EFEA] pb-5">
          <div>
            <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-[#1C1C1A] leading-tight">
              Sources
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-[#6B7280]">
              Upload slides, books, or YouTube videos to expand your tutor&apos;s verified knowledge base.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[#D5E4D0] bg-[#E8F0E4] px-3 py-1 text-xs font-semibold text-[#1F4D3A]">
              {sources.length} {sources.length === 1 ? "source" : "sources"}
            </span>
            <span className="rounded-full border border-[#E7E5DE] bg-white px-3 py-1 text-xs font-medium text-[#6B7280] shadow-2xs">
              {totalChunks.toLocaleString()} chunks
            </span>
          </div>
        </div>

        {/* Global Error Banner */}
        {sourcesError && (
          <div className="rounded-2xl border border-[#F5C2B3] bg-[#FCF0EC] p-4 text-sm text-[#A83D24] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <svg className="h-4 w-4 shrink-0 text-[#D1703F]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{sourcesError}</span>
            </div>
            <button
              onClick={loadSources}
              className="text-xs font-semibold underline underline-offset-2 hover:text-[#7C2915]"
            >
              Retry
            </button>
          </div>
        )}

        {/* Active Job Progress / Status Card */}
        {activeJob && (
          <div
            className={`rounded-2xl border transition-all duration-300 p-6 sm:p-7 shadow-xs ${
              activeJob.status === "done"
                ? "border-[#D5E4D0] bg-[#E8F0E4]/70"
                : activeJob.status === "error"
                ? "border-[#F5C2B3] bg-[#FCF0EC]"
                : "border-[#1F4D3A]/20 bg-white"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/5 pb-4">
              <div className="flex items-center gap-3">
                {activeJob.status === "running" && (
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1F4D3A] text-white">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeLinecap="round" />
                    </svg>
                  </div>
                )}
                {activeJob.status === "done" && (
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2F7D5B] text-white">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
                {activeJob.status === "error" && (
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#D1703F] text-white">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </div>
                )}
                <div>
                  <h3 className="text-sm sm:text-base font-semibold text-[#1C1C1A]">
                    {activeJob.status === "running"
                      ? `Processing ${activeJob.sourceType === "pdf" ? "document" : "video"}`
                      : activeJob.status === "done"
                      ? "Indexing complete"
                      : "Processing failed"}
                  </h3>
                  <p className="text-xs text-[#6B7280] truncate max-w-md">
                    {activeJob.sourceName}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider ${
                    activeJob.status === "running"
                      ? "bg-[#1F4D3A]/10 text-[#1F4D3A] font-semibold animate-pulse"
                      : activeJob.status === "done"
                      ? "bg-[#2F7D5B]/15 text-[#1F4D3A] font-semibold"
                      : "bg-[#D1703F]/15 text-[#A83D24] font-semibold"
                  }`}
                >
                  {activeJob.status === "running" ? activeJob.stage : activeJob.status}
                </span>
                {activeJob.status !== "running" && (
                  <button
                    onClick={() => setActiveJob(null)}
                    className="cursor-pointer rounded-lg p-1 text-[#6B7280] hover:bg-black/5 hover:text-[#1C1C1A] transition"
                    title="Dismiss"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Stages Stepper */}
            <div className="mt-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {STAGES.map((s, idx) => {
                  const isCurrent = activeJob.status === "running" && (activeJob.stage === s.key || (s.key === "extracting" && activeJob.stage === "queued"));
                  const isFinished = activeJob.status === "done" || (activeJob.status === "running" && stageIdx > idx);
                  const isFailed = activeJob.status === "error" && stageIdx === idx;

                  return (
                    <div
                      key={s.key}
                      className={`relative rounded-xl border p-3 transition-all ${
                        isCurrent
                          ? "border-[#1F4D3A] bg-[#1F4D3A]/5 shadow-2xs"
                          : isFinished
                          ? "border-[#D5E4D0] bg-[#E8F0E4]/60"
                          : isFailed
                          ? "border-[#F5C2B3] bg-[#FCF0EC]"
                          : "border-[#E7E5DE] bg-white/60 opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            isFinished
                              ? "bg-[#2F7D5B] text-white"
                              : isCurrent
                              ? "bg-[#1F4D3A] text-white"
                              : isFailed
                              ? "bg-[#D1703F] text-white"
                              : "bg-[#EEF0EA] text-[#6B7280]"
                          }`}
                        >
                          {isFinished ? "✓" : idx + 1}
                        </div>
                        <span className="text-xs font-semibold text-[#1C1C1A]">{s.label}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-[#6B7280] leading-tight">{s.desc}</p>
                    </div>
                  );
                })}
              </div>

              {/* Progress bar line */}
              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[#EEF0EA]">
                <div
                  className={`h-full transition-all duration-500 ease-out ${
                    activeJob.status === "error"
                      ? "bg-[#D1703F]"
                      : activeJob.status === "done"
                      ? "bg-[#2F7D5B]"
                      : "bg-[#1F4D3A]"
                  }`}
                  style={{
                    width:
                      activeJob.status === "done"
                        ? "100%"
                        : activeJob.status === "error"
                        ? "100%"
                        : activeJob.stage === "queued"
                        ? "15%"
                        : activeJob.stage === "extracting"
                        ? "35%"
                        : activeJob.stage === "embedding"
                        ? "65%"
                        : activeJob.stage === "indexing"
                        ? "90%"
                        : "50%",
                  }}
                />
              </div>
            </div>

            {/* Note or Error details */}
            {activeJob.status === "done" && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/80 p-3 text-xs text-[#1F4D3A]">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Success!</span>
                  <span>
                    {activeJob.note
                      ? activeJob.note
                      : `Indexed successfully${activeJob.chunks ? ` (${activeJob.chunks} chunks)` : ""}.`}
                  </span>
                </div>
                <span className="text-[11px] text-[#6B7280]">Updated course index</span>
              </div>
            )}

            {activeJob.status === "error" && (
              <div className="mt-4 rounded-xl bg-white/90 p-3 text-xs text-[#A83D24]">
                <span className="font-semibold">Error details: </span>
                <span>{activeJob.error || "An unknown error occurred during ingestion."}</span>
              </div>
            )}
          </div>
        )}

        {/* Input Cards: 2 Columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: PDF Upload Card */}
          <div className={cardStyle}>
            <div className="flex items-center gap-3 border-b border-[#F0EFEA] pb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#E8F0E4] text-[#1F4D3A]">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-semibold tracking-tight text-[#1C1C1A]">
                  Upload PDF
                </h2>
                <p className="text-xs text-[#6B7280]">Lecture slides or textbook (up to 40 MB)</p>
              </div>
            </div>

            <form onSubmit={handleUploadPdf} className="mt-5 space-y-4">
              {/* Kind selector: Slides vs Textbook */}
              <div>
                <label className="block text-xs font-semibold text-[#1C1C1A] mb-1.5">
                  Document Type
                </label>
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#E7E5DE] bg-[#FAFAF7] p-1">
                  <button
                    type="button"
                    onClick={() => setKind("slides")}
                    className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition cursor-pointer ${
                      kind === "slides"
                        ? "bg-white text-[#1C1C1A] shadow-xs font-semibold"
                        : "text-[#6B7280] hover:text-[#1C1C1A]"
                    }`}
                  >
                    <svg className="h-3.5 w-3.5 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                    </svg>
                    Slides
                  </button>
                  <button
                    type="button"
                    onClick={() => setKind("book")}
                    className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition cursor-pointer ${
                      kind === "book"
                        ? "bg-white text-[#1C1C1A] shadow-xs font-semibold"
                        : "text-[#6B7280] hover:text-[#1C1C1A]"
                    }`}
                  >
                    <svg className="h-3.5 w-3.5 text-[#1F4D3A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                    Textbook
                  </button>
                </div>
              </div>

              {/* PDF file picker / dropzone */}
              <div>
                <label className="block text-xs font-semibold text-[#1C1C1A] mb-1.5">
                  PDF File
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                  className="hidden"
                  id="pdf-file-input"
                />

                {!pdfFile ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragOver(false);
                      const dropped = e.dataTransfer.files?.[0];
                      if (dropped) handleFileChange(dropped);
                    }}
                    className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition ${
                      isDragOver
                        ? "border-[#1F4D3A] bg-[#E8F0E4]/40"
                        : "border-[#E7E5DE] bg-[#FAFAF7] hover:border-[#1F4D3A]/40 hover:bg-white"
                    }`}
                  >
                    <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-white border border-[#E7E5DE] text-[#6B7280] shadow-2xs">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <p className="text-xs sm:text-sm font-medium text-[#1C1C1A]">
                      Choose PDF or drag here
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#6B7280]">
                      Standard text-based PDF documents
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-[#D5E4D0] bg-[#E8F0E4]/40 p-3.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1F4D3A] text-white">
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-[#1C1C1A]">
                          {pdfFile.name}
                        </p>
                        <p className="text-[11px] text-[#6B7280]">{formatBytes(pdfFile.size)}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPdfFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="cursor-pointer text-xs font-medium text-[#6B7280] hover:text-[#A83D24] transition"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {pdfError && (
                <div className="rounded-xl border border-[#F5C2B3] bg-[#FCF0EC] p-3 text-xs text-[#A83D24]">
                  {pdfError}
                </div>
              )}

              <button
                type="submit"
                disabled={!pdfFile || isUploadingPdf || isJobRunning}
                className="w-full inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#1F4D3A] px-5 py-2.5 text-sm font-medium text-white shadow-xs transition-all duration-150 hover:bg-[#285E47] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUploadingPdf ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeLinecap="round" />
                    </svg>
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span>Upload</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Card 2: YouTube Video Card */}
          <div className={cardStyle}>
            <div className="flex items-center gap-3 border-b border-[#F0EFEA] pb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 4 18 12 6 20 6 4" />
                </svg>
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-semibold tracking-tight text-[#1C1C1A]">
                  Add YouTube video
                </h2>
                <p className="text-xs text-[#6B7280]">Extract and index video captions automatically</p>
              </div>
            </div>

            <form onSubmit={handleAddYoutube} className="mt-5 space-y-4">
              <div>
                <label htmlFor="youtube-url-input" className="block text-xs font-semibold text-[#1C1C1A] mb-1.5">
                  YouTube Video Link
                </label>
                <div className="relative">
                  <input
                    id="youtube-url-input"
                    type="text"
                    value={youtubeUrl}
                    onChange={(e) => {
                      setYoutubeUrl(e.target.value);
                      if (youtubeError) setYoutubeError(null);
                    }}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full rounded-xl border border-[#E7E5DE] bg-white px-3.5 py-2.5 text-xs sm:text-sm text-[#1C1C1A] placeholder:text-[#9CA3AF] outline-none transition focus:border-[#1F4D3A] focus:ring-2 focus:ring-[#1F4D3A]/15 shadow-2xs"
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-[#6B7280]">
                  Accepts standard watch links, youtu.be short links, or an 11-character video ID.
                </p>
              </div>

              {/* Note on captions requirement */}
              <div className="rounded-xl border border-[#E7E5DE] bg-[#FAFAF7] p-3 text-[11px] text-[#6B7280] leading-relaxed">
                <span className="font-semibold text-[#1C1C1A]">Captions notice: </span>
                The video must have closed captions (English or auto-generated) enabled on YouTube for indexing.
              </div>

              {youtubeError && (
                <div className="rounded-xl border border-[#F5C2B3] bg-[#FCF0EC] p-3 text-xs text-[#A83D24]">
                  {youtubeError}
                </div>
              )}

              <button
                type="submit"
                disabled={!youtubeUrl.trim() || isAddingYoutube || isJobRunning}
                className="w-full inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#1F4D3A] px-5 py-2.5 text-sm font-medium text-white shadow-xs transition-all duration-150 hover:bg-[#285E47] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAddingYoutube ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeLinecap="round" />
                    </svg>
                    <span>Adding...</span>
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <span>Add video</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Sources List / Table Card */}
        <div className={cardStyle}>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#F0EFEA] pb-5">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-[#1C1C1A]">
                Indexed materials
              </h2>
              <p className="mt-0.5 text-xs text-[#6B7280]">
                All sources currently powering tutor chat answers and practice quizzes
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Search bar */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Filter sources..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-36 sm:w-48 rounded-lg border border-[#E7E5DE] bg-white px-2.5 py-1.5 text-xs text-[#1C1C1A] placeholder:text-[#9CA3AF] outline-none transition focus:border-[#1F4D3A] focus:ring-2 focus:ring-[#1F4D3A]/15 shadow-2xs"
                />
              </div>

              {/* Refresh button */}
              <button
                onClick={loadSources}
                disabled={isLoadingSources}
                title="Refresh list"
                className="flex cursor-pointer items-center justify-center rounded-lg border border-[#E7E5DE] bg-white p-1.5 text-[#6B7280] shadow-2xs transition hover:bg-[#FAFAF7] hover:text-[#1C1C1A] disabled:opacity-50"
              >
                <svg
                  className={`h-4 w-4 ${isLoadingSources ? "animate-spin" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-1.19" />
                </svg>
              </button>
            </div>
          </div>

          {/* Table / List */}
          <div className="mt-4">
            {isLoadingSources && sources.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EEF0EA] text-[#1F4D3A]">
                  <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="mt-3 text-sm font-medium text-[#1C1C1A]">Loading sources...</p>
                <p className="mt-0.5 text-xs text-[#6B7280]">Fetching from course knowledge base</p>
              </div>
            ) : filteredSources.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF0EA] text-[#6B7280]">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-[#1C1C1A]">
                  {searchQuery ? "No matching sources found" : "No sources added yet"}
                </p>
                <p className="mt-0.5 text-xs text-[#6B7280]">
                  {searchQuery
                    ? "Try adjusting your search terms"
                    : "Upload a PDF or add a YouTube link above to index materials."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#F0EFEA] text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
                      <th className="pb-3 pr-4">Source</th>
                      <th className="pb-3 px-4">Type</th>
                      <th className="pb-3 px-4 text-right">Chunks</th>
                      <th className="pb-3 pl-4 text-right">Origin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EFEA]">
                    {filteredSources.map((s) => (
                      <tr key={s.id} className="group hover:bg-[#FAFAF7]/70 transition-colors">
                        <td className="py-3.5 pr-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FAFAF7] border border-[#E7E5DE] text-[#6B7280]">
                              {s.type === "slide" && (
                                <svg className="h-4 w-4 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="2" y="3" width="20" height="14" rx="2" />
                                  <line x1="8" y1="21" x2="16" y2="21" />
                                </svg>
                              )}
                              {s.type === "book" && (
                                <svg className="h-4 w-4 text-[#1F4D3A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                                </svg>
                              )}
                              {s.type === "video" && (
                                <svg className="h-4 w-4 text-rose-600" viewBox="0 0 24 24" fill="currentColor">
                                  <polygon points="6 4 18 12 6 20 6 4" />
                                </svg>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-[#1C1C1A] max-w-xs sm:max-w-md" title={s.name}>
                                {s.name}
                              </p>
                              <p className="text-[11px] text-[#9CA3AF] font-mono truncate max-w-xs">
                                {s.id}
                              </p>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <SourceTypeBadge type={s.type} />
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <span className="font-semibold text-[#1C1C1A]">
                            {s.chunks.toLocaleString()}
                          </span>
                          <span className="text-xs text-[#6B7280] ml-1">chunks</span>
                        </td>

                        <td className="py-3.5 pl-4 text-right whitespace-nowrap">
                          {s.uploaded ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              Uploaded
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                              Course seed
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
