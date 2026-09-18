"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Card, EmptyState, Spinner } from "@/components/ui";
import { formatDateTime } from "@/lib/datetime";
import { BookIcon, UploadIcon } from "@/components/icons";

type Material = {
  id: string;
  project_id: string;
  filename: string;
  status: "QUEUED" | "PROCESSING" | "READY" | "FAILED";
  page_count: number | null;
  processing_error: string | null;
  created_at: string;
};

function StatusBadge({ status }: { status: Material["status"] }) {
  const tone = status === "READY" ? "success" : status === "FAILED" ? "danger" : status === "QUEUED" ? "warning" : "accent";
  return (
    <Badge tone={tone}>
      {(status === "QUEUED" || status === "PROCESSING") && (
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      )}
      {status}
    </Badge>
  );
}

export default function MaterialsClient({
  projectId,
  initialMaterials,
  initialHighlightId,
}: {
  projectId: string;
  initialMaterials: Material[];
  /** deep-link: highlight + scroll to this material's row (e.g. from the dashboard) */
  initialHighlightId?: string | null;
}) {
  const [materials, setMaterials] = useState<Material[]>(initialMaterials);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLTableRowElement | null>(null);

  // Deep-linked material: scroll it into view on first paint.
  useEffect(() => {
    if (initialHighlightId) highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/materials`);
      if (!res.ok) return;
      const data = await res.json();
      setMaterials(data);
    } catch {
      // ignore
    }
  }, [projectId]);

  // Poll while any material is QUEUED/PROCESSING (no feature ships without Processing state)
  useEffect(() => {
    const hasProcessing = materials.some((m) => m.status === "QUEUED" || m.status === "PROCESSING");
    if (!hasProcessing) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [materials, refresh]);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = e.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      setError("Please select a PDF file");
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are allowed");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File too large — max 10 MB");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/materials`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed");
        setUploading(false);
        return;
      }
      // Optimistic: add queued item
      setMaterials((prev) => [
        {
          id: data.id,
          project_id: projectId,
          filename: file.name,
          status: "QUEUED",
          page_count: null,
          processing_error: null,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
      form.reset();
      setTimeout(refresh, 800);
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleRetry(materialId: string) {
    setRetryingId(materialId);
    setError("");
    try {
      const res = await fetch(`/api/materials/${materialId}/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Retry failed");
        return;
      }
      setMaterials((prev) => prev.map((m) => (m.id === materialId ? { ...m, status: "QUEUED", processing_error: null } : m)));
      setTimeout(refresh, 800);
    } finally {
      setRetryingId(null);
    }
  }

  async function handleDelete(materialId: string, status: Material["status"]) {
    if (status === "READY" && !window.confirm("Delete this material and its chunks? Concepts already extracted stay as-is.")) {
      return;
    }
    setDeletingId(materialId);
    setError("");
    try {
      const res = await fetch(`/api/materials/${materialId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Delete failed");
        return;
      }
      setMaterials((prev) => prev.filter((m) => m.id !== materialId));
    } finally {
      setDeletingId(null);
    }
  }

  const isEmpty = materials.length === 0;

  return (
    <div className="fade-enter space-y-5">
      <Card className="p-5">
        <form onSubmit={handleUpload} className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="material-file" className="mb-1.5 block text-sm font-medium text-stone-700">
              Upload PDF
            </label>
            <input
              id="material-file"
              name="file"
              type="file"
              accept="application/pdf"
              className="block w-full cursor-pointer rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-2.5 text-sm text-stone-600 transition-colors file:mr-4 file:rounded-md file:border-0 file:bg-sky-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:border-sky-600 hover:file:bg-stone-800"
              disabled={uploading}
            />
            <p className="mt-1.5 text-xs text-stone-400">PDF only, max 10 MB. Status moves QUEUED → PROCESSING → READY.</p>
          </div>
          <Button type="submit" disabled={uploading} className="shrink-0">
            {uploading ? <Spinner className="text-white" /> : <UploadIcon className="h-4 w-4" />}
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </form>
      </Card>

      {error && <Alert>{error}</Alert>}

      {isEmpty ? (
        <EmptyState
          icon={<BookIcon className="h-5 w-5" />}
          title="No materials yet"
          description="Upload a PDF to extract concepts and unlock the Tutor, quizzes and recommendations."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-stone-500">File</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-stone-500">Status</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-stone-500 sm:table-cell">Pages</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-stone-500 md:table-cell">Created</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-stone-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {materials.map((m) => (
                  <tr
                    key={m.id}
                    ref={m.id === initialHighlightId ? highlightRef : undefined}
                    className={`transition-colors hover:bg-stone-50/70 ${
                      m.id === initialHighlightId ? "bg-sky-50/70" : ""
                    }`}
                  >
                    <td className="max-w-[220px] px-4 py-3 font-medium text-stone-900">
                      <span className="block truncate" title={m.filename}>{m.filename}</span>
                      {m.status === "FAILED" && m.processing_error && (
                        <p className="mt-1 max-w-md truncate text-xs font-normal text-red-600" title={m.processing_error}>{m.processing_error}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={m.status} />
                    </td>
                    <td className="tnum hidden px-4 py-3 text-stone-600 sm:table-cell">{m.page_count ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-stone-500 md:table-cell">{formatDateTime(m.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {m.status !== "READY" && (
                        <button
                          onClick={() => handleRetry(m.id)}
                          disabled={retryingId === m.id || deletingId === m.id}
                          title={m.status === "FAILED" ? "Re-run the processing pipeline" : "Re-trigger processing (stuck items return to QUEUED)"}
                          className="mr-3 inline-flex items-center gap-1.5 text-sm font-medium text-stone-800 hover:text-stone-900 disabled:opacity-50"
                        >
                          {retryingId === m.id && <Spinner />}
                          {retryingId === m.id ? "Retrying…" : "Retry"}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(m.id, m.status)}
                        disabled={deletingId === m.id || retryingId === m.id}
                        title={m.status === "FAILED" ? "Remove this failed upload" : "Delete material and its chunks"}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        {deletingId === m.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="text-xs text-stone-400">
        Background pipeline: upload → PROCESSING → extract → chunk → embed (Gemini gemini-embedding-001, 768) → concepts (Mercury) → READY. Failures land in FAILED with retry/delete actions.
      </p>
    </div>
  );
}
