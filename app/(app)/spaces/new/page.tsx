"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, PageHeader, Spinner, inputClass } from "@/components/ui";

export default function NewSpacePage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create space");
        setLoading(false);
        return;
      }
      const space = await res.json();
      router.push(`/spaces/${space.id}`);
      router.refresh();
    } catch {
      setError("Failed to create space");
      setLoading(false);
    }
  }

  return (
    <div className="page-enter mx-auto max-w-2xl">
      <PageHeader
        title="New Space"
        description="Spaces group related projects together — e.g. one space per course."
      />
      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && <Alert>{error}</Alert>}
          <Field label="Name">
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="e.g. Biology 101"
              disabled={loading}
            />
          </Field>
          <Field label="Description" hint="Optional — a line about what this space covers.">
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={inputClass}
              placeholder="Cell biology, genetics, exam prep…"
              disabled={loading}
            />
          </Field>
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={loading}>
              {loading && <Spinner className="text-white" />}
              {loading ? "Creating…" : "Create Space"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
