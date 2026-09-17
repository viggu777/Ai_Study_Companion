"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, EmptyState } from "@/components/ui";
import { SparkIcon } from "@/components/icons";

interface Rec {
  id: string;
  title: string;
  action_items: string[];
  status: string;
  created_at: string;
}

const filters = ["ALL", "ACTIVE", "COMPLETED", "DISMISSED"] as const;

export default function RecommendationClient({ projectId }: { projectId: string }) {
  const [recs, setRecs] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof filters)[number]>("ALL");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchRecs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/recommendations`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch");
      setRecs(data.recommendations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const updateStatus = async (id: string, status: "COMPLETED" | "DISMISSED" | "ACTIVE") => {
    setUpdatingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/recommendations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      setRecs((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdatingId(null);
    }
  };

  const filtered = recs.filter((r) => (filter === "ALL" ? true : r.status === filter));

  return (
    <div className="fade-enter space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f
                ? "border-sky-600 bg-sky-600 text-white shadow-sm"
                : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50"
            }`}
          >
            {f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
        <button
          onClick={fetchRecs}
          className="ml-auto text-xs font-medium text-stone-800 hover:text-stone-900"
        >
          Refresh
        </button>
      </div>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading recommendations">
          <div className="skeleton h-32 w-full" />
          <div className="skeleton h-32 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<SparkIcon className="h-5 w-5" />}
          title={filter === "ALL" ? "No recommendations yet" : `No ${filter.toLowerCase()} recommendations`}
          description="Complete a quiz that leaves a concept weak — a specific recommendation naming that concept appears after mastery updates."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <Card
              key={r.id}
              className={`p-5 transition-opacity ${r.status === "DISMISSED" ? "opacity-70" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="font-semibold tracking-tight text-stone-900">{r.title}</h3>
                  <p className="tnum mt-0.5 text-xs text-stone-400">
                    {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
                <Badge
                  tone={r.status === "ACTIVE" ? "accent" : r.status === "COMPLETED" ? "success" : "neutral"}
                  className="shrink-0"
                >
                  {r.status}
                </Badge>
              </div>
              <ol className="mt-3 space-y-2">
                {r.action_items.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2.5 text-sm text-stone-700">
                    <span
                      aria-hidden
                      className="tnum mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-50 text-[11px] font-semibold text-stone-800"
                    >
                      {idx + 1}
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
              {r.status === "ACTIVE" && (
                <div className="mt-4 flex gap-2 border-t border-stone-100 pt-3">
                  <Button
                    size="sm"
                    onClick={() => updateStatus(r.id, "COMPLETED")}
                    disabled={updatingId === r.id}
                  >
                    {updatingId === r.id ? "Saving…" : "Mark completed"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => updateStatus(r.id, "DISMISSED")}
                    disabled={updatingId === r.id}
                  >
                    Dismiss
                  </Button>
                </div>
              )}
              {r.status !== "ACTIVE" && (
                <button
                  onClick={() => updateStatus(r.id, "ACTIVE")}
                  disabled={updatingId === r.id}
                  className="mt-3 text-xs font-medium text-stone-800 hover:text-stone-900 disabled:opacity-50"
                >
                  Reactivate
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
