"use client";

import { useEffect, useState, useRef } from "react";
import { Badge, Button, Spinner, inputClass } from "@/components/ui";
import { ArrowRightIcon, BookIcon, ChatIcon } from "@/components/icons";

interface Citation {
  materialId: string;
  materialName: string;
  page: number;
  chunkId: string;
}

interface TutorResponse {
  answer: string;
  confidence: "high" | "medium" | "low";
  grounded: boolean;
  citations: Citation[];
  followUpSuggestion: string;
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  citations: unknown;
  created_at: string;
  parsed?: TutorResponse | null;
}

function parseAssistant(m: MessageRow): TutorResponse | null {
  if (m.parsed) return m.parsed;
  try {
    return JSON.parse(m.content) as TutorResponse;
  } catch {
    return null;
  }
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1" aria-label="Generating answer">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 animate-bounce rounded-full bg-emerald-700"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

export default function TutorClient({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const scrollBottom = () => bottomRef.current?.scrollIntoView({ behavior: "smooth" });

  const fetchHistory = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/tutor`);
      if (!res.ok) throw new Error("Failed to fetch history");
      const data = await res.json();
      setMessages((data.messages ?? []) as MessageRow[]);
    } catch (e) {
      console.error(e);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    scrollBottom();
  }, [messages, loading]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;
    setError(null);
    setLoading(true);
    // Optimistic user message
    const tempId = `temp-user-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, role: "user", content: q, citations: null, created_at: new Date().toISOString() }]);
    setQuestion("");

    try {
      const res = await fetch(`/api/projects/${projectId}/tutor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Tutor request failed");

      // data is TutorResponse & { conversationId }
      const assistantMsg: MessageRow = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: JSON.stringify(data),
        citations: data.citations,
        created_at: new Date().toISOString(),
        parsed: data as TutorResponse,
      };
      setMessages((prev) => [...prev.filter((m) => m.id !== tempId), { id: tempId.replace("temp-user", "user"), role: "user", content: q, citations: null, created_at: new Date().toISOString() }, assistantMsg]);
      // Refresh from server to get canonical ids
      fetchHistory();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Keep optimistic user message but remove temp
      setMessages((prev) => prev.filter((m) => m.id !== tempId).concat([{ id: `user-${Date.now()}`, role: "user", content: q, citations: null, created_at: new Date().toISOString() }]));
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-card" aria-busy="true" aria-label="Loading conversation">
        <div className="space-y-3">
          <div className="skeleton h-10 w-2/3" />
          <div className="ml-auto skeleton h-10 w-1/2" />
          <div className="skeleton h-16 w-3/4" />
        </div>
      </div>
    );
  }

  return (
    <div className="fade-enter flex h-[70vh] flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-card">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        {messages.length === 0 && (
          <div className="py-10 text-center">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-700/[0.08] text-emerald-800">
              <ChatIcon className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-stone-900">Ask anything about your materials</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
              Try: &quot;What are the key concepts in my PDF?&quot; Answers cite the exact page.
            </p>
          </div>
        )}
        {messages.map((m) => {
          if (m.role === "user") {
            return (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-emerald-700 px-4 py-2.5 shadow-card">
                  <p className="whitespace-pre-wrap text-sm text-white">{m.content}</p>
                </div>
              </div>
            );
          }
          const parsed = parseAssistant(m);
          if (!parsed) {
            return (
              <div key={m.id} className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-stone-200 bg-stone-50 px-4 py-2.5">
                  <p className="whitespace-pre-wrap text-sm text-stone-800">{m.content}</p>
                </div>
              </div>
            );
          }
          const isInsufficient = !parsed.grounded && parsed.citations.length === 0;
          return (
            <div key={m.id} className="flex justify-start">
              <div
                className={`max-w-[88%] rounded-2xl rounded-bl-md border px-4 py-3 shadow-card ${
                  isInsufficient
                    ? "border-amber-300 bg-amber-50"
                    : "border-stone-200 bg-white"
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <Badge
                    tone={
                      parsed.confidence === "high"
                        ? "success"
                        : parsed.confidence === "medium"
                          ? "accent"
                          : "warning"
                    }
                  >
                    {parsed.confidence} confidence
                  </Badge>
                  <Badge tone={parsed.grounded ? "success" : "danger"}>
                    {parsed.grounded ? "grounded" : "not grounded"}
                  </Badge>
                  {isInsufficient && <Badge tone="warning">insufficient evidence</Badge>}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-900">{parsed.answer}</p>
                {parsed.citations.length > 0 && (
                  <div className="mt-3 border-t border-stone-100 pt-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {parsed.citations.map((c, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-600">
                          <BookIcon className="h-3 w-3" />
                          {c.materialName} · p.{c.page}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {parsed.followUpSuggestion && (
                  <p className="mt-2.5 text-xs italic text-stone-500">Next: {parsed.followUpSuggestion}</p>
                )}
              </div>
            </div>
          );
        })}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md border border-stone-200 bg-white px-4 py-3 shadow-card">
              <TypingDots />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="border-t border-stone-200 bg-stone-50/60 p-3 sm:p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about your materials…"
            className={inputClass}
            disabled={loading}
            aria-label="Ask a question"
          />
          <Button type="submit" disabled={loading || !question.trim()} className="shrink-0">
            {loading ? <Spinner className="text-white" /> : <ArrowRightIcon className="h-4 w-4" />}
            <span className="hidden sm:inline">{loading ? "Asking" : "Ask"}</span>
          </Button>
        </div>
        <p className="mt-2 text-xs text-stone-400">Answers are grounded in your project&apos;s uploaded PDFs, with page citations.</p>
      </form>
    </div>
  );
}
