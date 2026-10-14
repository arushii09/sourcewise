"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { API, Course, HeaderNav, useCourse, useStudent } from "../shared";

type SourceItem = {
  id: string;
  name: string;
  type: "slide" | "book" | "video" | string;
  chunks: number;
  uploaded: boolean;
  course_id?: string;
  course_name?: string;
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
  courseId?: string;
};

function SourceTypeBadge({ type }: { type: string }) {
  if (type === "slide") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FBCFE8] bg-[#FDF2F8] px-2.5 py-0.5 text-xs font-medium text-[#9D174D]">
        <svg className="h-3 w-3 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
        </svg>
        Slide
      </span>
    );
  }
  if (type === "book") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FECDD3] bg-[#FFF1F2] px-2.5 py-0.5 text-xs font-medium text-[#BE123C]">
        <svg className="h-3 w-3 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        Book
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FED7AA] bg-[#FFF7ED] px-2.5 py-0.5 text-xs font-medium text-[#C2410C]">
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
  const [selectedCourseId, setSelectedCourseId] = useCourse("default");

  // Courses state
  const [coursesList, setCoursesList] = useState<Course[]>([]);
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseDesc, setNewCourseDesc] = useState("");
  const [courseCreateError, setCourseCreateError] = useState<string | null>(null);

  // Sources list state
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Deletion state
  const [sourceToDelete, setSourceToDelete] = useState<SourceItem | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  // Upload PDF card state
  const [targetCourseForPdf, setTargetCourseForPdf] = useState("default");
  const [kind, setKind] = useState<"slides" | "book">("slides");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // YouTube card state
  const [targetCourseForYt, setTargetCourseForYt] = useState("default");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [isAddingYoutube, setIsAddingYoutube] = useState(false);

  // Active / Last Job state
  const [activeJob, setActiveJob] = useState<JobInfo | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const cardStyle = "rounded-2xl border border-[#F3D2DC] bg-white p-6 sm:p-8 shadow-xs";

  // Sync target course with selected course when user switches courses (if not "all")
  useEffect(() => {
    if (selectedCourseId && selectedCourseId !== "all") {
      setTargetCourseForPdf(selectedCourseId);
      setTargetCourseForYt(selectedCourseId);
    }
  }, [selectedCourseId]);

  // Fetch courses from GET /courses
  const loadCourses = useCallback(async () => {
    try {
      const res = await fetch(`${API}/courses`);
      if (res.ok) {
        const data: Course[] = await res.json();
        setCoursesList(data);
      }
    } catch {
      // Backend not yet reachable or offline
    }
  }, []);

  // Fetch sources list from GET /sources?course_id=...
  const loadSources = useCallback(async () => {
    try {
      setSourcesError(null);
      const url =
        selectedCourseId && selectedCourseId !== "all"
          ? `${API}/sources?course_id=${encodeURIComponent(selectedCourseId)}`
          : `${API}/sources`;
      const res = await fetch(url);
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
  }, [selectedCourseId]);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

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
    (jobId: string, sourceName: string, sourceType: "pdf" | "youtube", courseId: string) => {
      stopPolling();
      setActiveJob({
        jobId,
        status: "running",
        stage: "queued",
        sourceName,
        sourceType,
        courseId,
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
            courseId: prev?.courseId || courseId,
          }));

          if (data.status === "done") {
            stopPolling();
            loadSources();
            loadCourses();
            setSuccessBanner(`Source "${sourceName}" successfully indexed into the course!`);
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
            courseId: prev?.courseId || courseId,
          }));
        }
      }, 1500);
    },
    [loadSources, loadCourses, stopPolling]
  );

  // Handle course creation
  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCourseName.trim()) {
      setCourseCreateError("Course name is required.");
      return;
    }
    setCourseCreateError(null);
    try {
      const res = await fetch(`${API}/courses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCourseName.trim(),
          description: newCourseDesc.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || `Failed with status ${res.status}`);
      }
      const created: Course = await res.json();
      await loadCourses();
      setSelectedCourseId(created.id);
      setTargetCourseForPdf(created.id);
      setTargetCourseForYt(created.id);
      setNewCourseName("");
      setNewCourseDesc("");
      setIsCreatingCourse(false);
      setSuccessBanner(`Course "${created.name}" created! You can now upload materials to it.`);
    } catch (err: any) {
      setCourseCreateError(err.message || "Failed to create course");
    }
  };

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
      formData.append("course_id", targetCourseForPdf || "default");

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
      startPolling(job_id, fileName, "pdf", targetCourseForPdf);
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
        body: JSON.stringify({
          url,
          course_id: targetCourseForYt || "default",
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || `Failed with status ${res.status}`);
      }

      const { job_id } = await res.json();
      setYoutubeUrl("");
      startPolling(job_id, url, "youtube", targetCourseForYt);
    } catch (err: any) {
      setYoutubeError(err.message || "An error occurred while adding the YouTube video.");
    } finally {
      setIsAddingYoutube(false);
    }
  };

  // Delete a source
  const confirmDeleteSource = async () => {
    if (!sourceToDelete) return;
    const sId = sourceToDelete.id;
    const sName = sourceToDelete.name;
    setIsDeletingId(sId);
    try {
      const res = await fetch(`${API}/sources/${encodeURIComponent(sId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || `Deletion failed with status ${res.status}`);
      }
      setSourceToDelete(null);
      setSuccessBanner(`Source "${sName}" was successfully removed from the knowledge base.`);
      await loadSources();
      await loadCourses();
    } catch (err: any) {
      setSourcesError(err.message || "Failed to delete source");
    } finally {
      setIsDeletingId(null);
    }
  };

  const isJobRunning = activeJob?.status === "running";
  const stageIdx = activeJob ? getStageIndex(activeJob.stage) : 0;

  const currentCourse = coursesList.find((c) => c.id === selectedCourseId);

  const filteredSources = sources.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.course_name && s.course_name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const totalChunks = sources.reduce((acc, s) => acc + (s.chunks || 0), 0);

  return (
    <div className="min-h-screen bg-[#FDF2F5] font-sans text-[#1F1A1D] selection:bg-[#E11D48]/20 selection:text-[#E11D48]">
      <HeaderNav student={student} setStudent={setStudent} subtitle="Course Knowledge Base" />

      <main className="mx-auto max-w-[960px] space-y-6 px-4 sm:px-6 py-8">
        {/* Page Title & Course Selector Row */}
        <div className="flex flex-col gap-4 border-b border-[#F3D2DC] pb-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-[#1F1A1D] leading-tight">
                Sources
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-[#71646B]">
                Organize learning materials by course and expand verified source groundings.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[#FECDD3] bg-[#FFF1F2] px-3 py-1 text-xs font-semibold text-[#BE123C]">
                {sources.length} {sources.length === 1 ? "source" : "sources"}
              </span>
              <span className="rounded-full border border-[#F3D2DC] bg-white px-3 py-1 text-xs font-medium text-[#71646B] shadow-2xs">
                {totalChunks.toLocaleString()} chunks
              </span>
            </div>
          </div>

          {/* Course Scope Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#F3D2DC] bg-white p-3.5 sm:p-4 shadow-2xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#FFF0F4] text-[#E11D48] border border-[#F3D2DC]">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              </div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[#71646B]">
                Active Course:
              </span>

              {/* Course Selector Dropdown */}
              <select
                value={selectedCourseId}
                onChange={(e) => setSelectedCourseId(e.target.value)}
                className="cursor-pointer rounded-xl border border-[#F3D2DC] bg-[#FFF0F4] px-3 py-1.5 text-xs sm:text-sm font-semibold text-[#1F1A1D] outline-none transition focus:border-[#E11D48] focus:ring-2 focus:ring-[#E11D48]/15"
              >
                <option value="all">All Courses (view everything)</option>
                {coursesList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.chunks_count ? `(${c.chunks_count} chunks)` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Create course button */}
            <button
              onClick={() => setIsCreatingCourse(!isCreatingCourse)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#F3D2DC] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#E11D48] shadow-2xs transition hover:bg-[#FFF0F4] active:scale-[0.98]"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {isCreatingCourse ? "Close" : "New Course"}
            </button>
          </div>

          {/* New Course Creation Form Modal/Panel */}
          {isCreatingCourse && (
            <div className="rounded-2xl border border-[#FECDD3] bg-[#FFF1F2]/60 p-5 shadow-xs transition-all">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[#1F1A1D]">Create a New Course</h3>
                <button
                  onClick={() => setIsCreatingCourse(false)}
                  className="text-xs text-[#71646B] hover:text-[#1F1A1D]"
                >
                  Cancel
                </button>
              </div>
              <form onSubmit={handleCreateCourse} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#71646B] mb-1">
                      Course Name <span className="text-[#E11D48]">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Data Structures & Algorithms"
                      value={newCourseName}
                      onChange={(e) => setNewCourseName(e.target.value)}
                      className="w-full rounded-xl border border-[#F3D2DC] bg-white px-3 py-2 text-xs sm:text-sm text-[#1F1A1D] outline-none focus:border-[#E11D48] focus:ring-2 focus:ring-[#E11D48]/15"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#71646B] mb-1">
                      Description (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Lecture notes, textbooks, and tutorial videos"
                      value={newCourseDesc}
                      onChange={(e) => setNewCourseDesc(e.target.value)}
                      className="w-full rounded-xl border border-[#F3D2DC] bg-white px-3 py-2 text-xs sm:text-sm text-[#1F1A1D] outline-none focus:border-[#E11D48] focus:ring-2 focus:ring-[#E11D48]/15"
                    />
                  </div>
                </div>

                {courseCreateError && (
                  <p className="text-xs text-[#E11D48] font-medium">{courseCreateError}</p>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="cursor-pointer rounded-xl bg-[#E11D48] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#F43F5E] transition active:scale-[0.98]"
                  >
                    Save Course
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Success Banner */}
        {successBanner && (
          <div className="flex items-center justify-between rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] p-4 text-xs sm:text-sm text-[#BE123C]">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 shrink-0 text-[#E11D48]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{successBanner}</span>
            </div>
            <button
              onClick={() => setSuccessBanner(null)}
              className="text-xs font-semibold text-[#BE123C]/70 hover:text-[#BE123C]"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Global Error Banner */}
        {sourcesError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <svg className="h-4 w-4 shrink-0 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{sourcesError}</span>
            </div>
            <button
              onClick={loadSources}
              className="text-xs font-semibold underline underline-offset-2 hover:text-rose-900"
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
                ? "border-[#FECDD3] bg-[#FFF1F2]/80"
                : activeJob.status === "error"
                ? "border-rose-300 bg-rose-50"
                : "border-[#F3D2DC] bg-white"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F3D2DC] pb-4">
              <div className="flex items-center gap-3">
                {activeJob.status === "running" && (
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E11D48] text-white">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeLinecap="round" />
                    </svg>
                  </div>
                )}
                {activeJob.status === "done" && (
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E11D48] text-white">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
                {activeJob.status === "error" && (
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-600 text-white">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </div>
                )}
                <div>
                  <h3 className="text-sm sm:text-base font-semibold text-[#1F1A1D]">
                    {activeJob.status === "running"
                      ? `Processing ${activeJob.sourceType === "pdf" ? "document" : "video"}`
                      : activeJob.status === "done"
                      ? "Indexing complete"
                      : "Processing failed"}
                  </h3>
                  <p className="text-xs text-[#71646B] truncate max-w-md">
                    {activeJob.sourceName}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider ${
                    activeJob.status === "running"
                      ? "bg-[#FFF0F4] text-[#E11D48] border border-[#F3D2DC] font-semibold animate-pulse"
                      : activeJob.status === "done"
                      ? "bg-[#FFF1F2] text-[#BE123C] font-semibold border border-[#FECDD3]"
                      : "bg-rose-100 text-rose-800 font-semibold"
                  }`}
                >
                  {activeJob.status === "running" ? activeJob.stage : activeJob.status}
                </span>
                {activeJob.status !== "running" && (
                  <button
                    onClick={() => setActiveJob(null)}
                    className="cursor-pointer rounded-lg p-1 text-[#71646B] hover:bg-[#FFF0F4] hover:text-[#1F1A1D] transition"
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
                  const isCurrent =
                    activeJob.status === "running" &&
                    (activeJob.stage === s.key || (s.key === "extracting" && activeJob.stage === "queued"));
                  const isFinished = activeJob.status === "done" || (activeJob.status === "running" && stageIdx > idx);
                  const isFailed = activeJob.status === "error" && stageIdx === idx;

                  return (
                    <div
                      key={s.key}
                      className={`relative rounded-xl border p-3 transition-all ${
                        isCurrent
                          ? "border-[#E11D48] bg-[#FFF0F4] shadow-2xs"
                          : isFinished
                          ? "border-[#FECDD3] bg-[#FFF1F2]"
                          : isFailed
                          ? "border-rose-300 bg-rose-50"
                          : "border-[#F3D2DC] bg-white opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            isFinished
                              ? "bg-[#E11D48] text-white"
                              : isCurrent
                              ? "bg-[#E11D48] text-white animate-pulse"
                              : isFailed
                              ? "bg-rose-600 text-white"
                              : "bg-[#FFF0F4] text-[#71646B] border border-[#F3D2DC]"
                          }`}
                        >
                          {isFinished ? "✓" : idx + 1}
                        </div>
                        <span className="text-xs font-semibold text-[#1F1A1D]">{s.label}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-[#71646B] leading-tight">{s.desc}</p>
                    </div>
                  );
                })}
              </div>

              {/* Progress bar line */}
              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[#FFE4E6]">
                <div
                  className={`h-full transition-all duration-500 ease-out ${
                    activeJob.status === "error"
                      ? "bg-rose-500"
                      : "bg-[#E11D48]"
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
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3 text-xs text-[#BE123C] border border-[#FECDD3]">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#E11D48]">Success!</span>
                  <span>
                    {activeJob.note
                      ? activeJob.note
                      : `Indexed successfully${activeJob.chunks ? ` (${activeJob.chunks} chunks)` : ""}.`}
                  </span>
                </div>
                <span className="text-[11px] text-[#71646B]">Updated course index</span>
              </div>
            )}

            {activeJob.status === "error" && (
              <div className="mt-4 rounded-xl bg-white p-3 text-xs text-rose-700 border border-rose-200">
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
            <div className="flex items-center justify-between border-b border-[#F3D2DC] pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#FFF0F4] text-[#E11D48] border border-[#F3D2DC]">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-semibold tracking-tight text-[#1F1A1D]">
                    Upload PDF
                  </h2>
                  <p className="text-xs text-[#71646B]">Slides or textbook (up to 40 MB)</p>
                </div>
              </div>
            </div>

            <form onSubmit={handleUploadPdf} className="mt-5 space-y-4">
              {/* Target Course Selector */}
              <div>
                <label className="block text-xs font-semibold text-[#1F1A1D] mb-1.5">
                  Target Course
                </label>
                <select
                  value={targetCourseForPdf}
                  onChange={(e) => setTargetCourseForPdf(e.target.value)}
                  className="w-full rounded-xl border border-[#F3D2DC] bg-[#FFF0F4] px-3 py-2 text-xs sm:text-sm font-medium text-[#1F1A1D] outline-none transition focus:border-[#E11D48] focus:ring-2 focus:ring-[#E11D48]/15 shadow-2xs"
                >
                  {coursesList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Kind selector: Slides vs Textbook */}
              <div>
                <label className="block text-xs font-semibold text-[#1F1A1D] mb-1.5">
                  Document Type
                </label>
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#F3D2DC] bg-[#FFF0F4] p-1">
                  <button
                    type="button"
                    onClick={() => setKind("slides")}
                    className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition cursor-pointer ${
                      kind === "slides"
                        ? "bg-white text-[#BE123C] shadow-xs font-semibold border border-[#F3D2DC]"
                        : "text-[#71646B] hover:text-[#1F1A1D]"
                    }`}
                  >
                    <svg className="h-3.5 w-3.5 text-[#E11D48]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                        ? "bg-white text-[#BE123C] shadow-xs font-semibold border border-[#F3D2DC]"
                        : "text-[#71646B] hover:text-[#1F1A1D]"
                    }`}
                  >
                    <svg className="h-3.5 w-3.5 text-[#E11D48]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                    Textbook
                  </button>
                </div>
              </div>

              {/* PDF file picker / dropzone */}
              <div>
                <label className="block text-xs font-semibold text-[#1F1A1D] mb-1.5">
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
                        ? "border-[#E11D48] bg-[#FFF0F4]"
                        : "border-[#F3D2DC] bg-[#FFF0F4]/40 hover:border-[#E11D48]/50 hover:bg-[#FFF0F4]"
                    }`}
                  >
                    <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-white border border-[#F3D2DC] text-[#E11D48] shadow-2xs">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <p className="text-xs sm:text-sm font-medium text-[#1F1A1D]">
                      Choose PDF or drag here
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#71646B]">
                      Standard text-based PDF documents
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-[#FECDD3] bg-[#FFF1F2] p-3.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#E11D48] text-white">
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-[#1F1A1D]">
                          {pdfFile.name}
                        </p>
                        <p className="text-[11px] text-[#71646B]">{formatBytes(pdfFile.size)}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPdfFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="cursor-pointer text-xs font-medium text-[#71646B] hover:text-[#E11D48] transition"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {pdfError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                  {pdfError}
                </div>
              )}

              <button
                type="submit"
                disabled={!pdfFile || isUploadingPdf || isJobRunning}
                className="w-full inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-all duration-150 hover:bg-[#F43F5E] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <span>Upload to Course</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Card 2: YouTube Video Card */}
          <div className={cardStyle}>
            <div className="flex items-center gap-3 border-b border-[#F3D2DC] pb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#FFF0F4] text-[#E11D48] border border-[#F3D2DC]">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 4 18 12 6 20 6 4" />
                </svg>
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-semibold tracking-tight text-[#1F1A1D]">
                  Add YouTube video
                </h2>
                <p className="text-xs text-[#71646B]">Extract and index video captions</p>
              </div>
            </div>

            <form onSubmit={handleAddYoutube} className="mt-5 space-y-4">
              {/* Target Course Selector */}
              <div>
                <label className="block text-xs font-semibold text-[#1F1A1D] mb-1.5">
                  Target Course
                </label>
                <select
                  value={targetCourseForYt}
                  onChange={(e) => setTargetCourseForYt(e.target.value)}
                  className="w-full rounded-xl border border-[#F3D2DC] bg-[#FFF0F4] px-3 py-2 text-xs sm:text-sm font-medium text-[#1F1A1D] outline-none transition focus:border-[#E11D48] focus:ring-2 focus:ring-[#E11D48]/15 shadow-2xs"
                >
                  {coursesList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="youtube-url-input" className="block text-xs font-semibold text-[#1F1A1D] mb-1.5">
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
                    className="w-full rounded-xl border border-[#F3D2DC] bg-white px-3.5 py-2.5 text-xs sm:text-sm text-[#1F1A1D] placeholder:text-[#A1939A] outline-none transition focus:border-[#E11D48] focus:ring-2 focus:ring-[#E11D48]/15 shadow-2xs"
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-[#71646B]">
                  Accepts watch links, youtu.be short links, or an 11-character video ID.
                </p>
              </div>

              {/* Note on captions requirement */}
              <div className="rounded-xl border border-[#F3D2DC] bg-[#FFF0F4] p-3 text-[11px] text-[#71646B] leading-relaxed">
                <span className="font-semibold text-[#1F1A1D]">Captions notice: </span>
                Video must have closed captions enabled on YouTube for automated text indexing.
              </div>

              {youtubeError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                  {youtubeError}
                </div>
              )}

              <button
                type="submit"
                disabled={!youtubeUrl.trim() || isAddingYoutube || isJobRunning}
                className="w-full inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-all duration-150 hover:bg-[#F43F5E] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <span>Add to Course</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Sources List / Table Card */}
        <div className={cardStyle}>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#F3D2DC] pb-5">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight text-[#1F1A1D]">
                  Indexed materials
                </h2>
                {currentCourse && selectedCourseId !== "all" && (
                  <span className="rounded-full border border-[#FECDD3] bg-[#FFF1F2] px-2.5 py-0.5 text-xs font-semibold text-[#BE123C]">
                    {currentCourse.name}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[#71646B]">
                {selectedCourseId === "all"
                  ? "Showing all materials across all courses"
                  : `Showing verified materials scoped to ${currentCourse?.name || "this course"}`}
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
                  className="w-36 sm:w-48 rounded-lg border border-[#F3D2DC] bg-[#FFF0F4] px-2.5 py-1.5 text-xs text-[#1F1A1D] placeholder:text-[#A1939A] outline-none transition focus:border-[#E11D48] focus:ring-2 focus:ring-[#E11D48]/15 shadow-2xs"
                />
              </div>

              {/* Refresh button */}
              <button
                onClick={() => {
                  loadSources();
                  loadCourses();
                }}
                disabled={isLoadingSources}
                title="Refresh list"
                className="flex cursor-pointer items-center justify-center rounded-lg border border-[#F3D2DC] bg-white p-1.5 text-[#71646B] shadow-2xs transition hover:bg-[#FFF0F4] hover:text-[#1F1A1D] disabled:opacity-50"
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
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFF0F4] text-[#E11D48] border border-[#F3D2DC]">
                  <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="mt-3 text-sm font-medium text-[#1F1A1D]">Loading sources...</p>
                <p className="mt-0.5 text-xs text-[#71646B]">Fetching from course knowledge base</p>
              </div>
            ) : filteredSources.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[#FFF0F4] text-[#71646B] border border-[#F3D2DC]">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-[#1F1A1D]">
                  {searchQuery
                    ? "No matching sources found"
                    : selectedCourseId !== "all"
                    ? `No sources in "${currentCourse?.name || "this course"}" yet`
                    : "No sources added yet"}
                </p>
                <p className="mt-0.5 text-xs text-[#71646B]">
                  {searchQuery
                    ? "Try adjusting your search terms"
                    : "Upload a PDF or add a YouTube link above to add materials to this course."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#F3D2DC] text-[11px] font-semibold uppercase tracking-[0.06em] text-[#71646B]">
                      <th className="pb-3 pr-4">Source</th>
                      <th className="pb-3 px-3">Type</th>
                      <th className="pb-3 px-3">Course</th>
                      <th className="pb-3 px-3 text-right">Chunks</th>
                      <th className="pb-3 px-3 text-right">Origin</th>
                      <th className="pb-3 pl-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3D2DC]">
                    {filteredSources.map((s) => (
                      <tr key={s.id} className="group hover:bg-[#FFF5F7] transition-colors">
                        <td className="py-3.5 pr-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFF0F4] border border-[#F3D2DC] text-[#71646B]">
                              {s.type === "slide" && (
                                <svg className="h-4 w-4 text-[#9D174D]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="2" y="3" width="20" height="14" rx="2" />
                                  <line x1="8" y1="21" x2="16" y2="21" />
                                </svg>
                              )}
                              {s.type === "book" && (
                                <svg className="h-4 w-4 text-[#BE123C]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                                </svg>
                              )}
                              {s.type === "video" && (
                                <svg className="h-4 w-4 text-[#C2410C]" viewBox="0 0 24 24" fill="currentColor">
                                  <polygon points="6 4 18 12 6 20 6 4" />
                                </svg>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-[#1F1A1D] max-w-xs sm:max-w-sm" title={s.name}>
                                {s.name}
                              </p>
                              <p className="text-[11px] text-[#A1939A] font-mono truncate max-w-xs">
                                {s.id}
                              </p>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <SourceTypeBadge type={s.type} />
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#71646B]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#E11D48]" />
                            {s.course_name || "MIT 6.0001 (Python)"}
                          </span>
                        </td>

                        <td className="py-3.5 px-3 text-right whitespace-nowrap">
                          <span className="font-semibold text-[#1F1A1D]">
                            {s.chunks.toLocaleString()}
                          </span>
                          <span className="text-xs text-[#71646B] ml-1">chunks</span>
                        </td>

                        <td className="py-3.5 px-3 text-right whitespace-nowrap">
                          {s.uploaded ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[#FECDD3] bg-[#FFF1F2] px-2 py-0.5 text-[11px] font-medium text-[#BE123C]">
                              <span className="h-1.5 w-1.5 rounded-full bg-[#E11D48]" />
                              Uploaded
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                              Course seed
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 pl-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => setSourceToDelete(s)}
                            disabled={isDeletingId === s.id}
                            title="Delete source"
                            className="cursor-pointer inline-flex items-center justify-center rounded-lg p-1.5 text-[#71646B] transition hover:bg-[#FFE4E6] hover:text-[#E11D48] active:scale-95 disabled:opacity-40"
                          >
                            {isDeletingId === s.id ? (
                              <svg className="h-4 w-4 animate-spin text-[#E11D48]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeLinecap="round" />
                              </svg>
                            ) : (
                              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <line x1="10" y1="11" x2="10" y2="17" />
                                <line x1="14" y1="11" x2="14" y2="17" />
                              </svg>
                            )}
                          </button>
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

      {/* Confirmation Modal for Source Deletion */}
      {sourceToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
          onClick={() => !isDeletingId && setSourceToDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-[#F3D2DC]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600 border border-rose-200">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-[#1F1A1D]">Delete Source</h3>
                <p className="text-xs text-[#71646B]">Confirm removal from course knowledge base</p>
              </div>
            </div>

            <p className="text-sm text-[#71646B] leading-relaxed">
              Delete <span className="font-semibold text-[#1F1A1D]">&ldquo;{sourceToDelete.name}&rdquo;</span>? Its indexed content ({sourceToDelete.chunks} chunks) will no longer be available for AI tutoring.
            </p>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setSourceToDelete(null)}
                disabled={Boolean(isDeletingId)}
                className="cursor-pointer rounded-xl border border-[#F3D2DC] bg-white px-4 py-2 text-xs font-semibold text-[#71646B] hover:bg-[#FFF0F4] hover:text-[#1F1A1D] transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteSource}
                disabled={Boolean(isDeletingId)}
                className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl bg-[#E11D48] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#F43F5E] transition active:scale-[0.98] disabled:opacity-50"
              >
                {isDeletingId ? (
                  <>
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeLinecap="round" />
                    </svg>
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Delete source</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
