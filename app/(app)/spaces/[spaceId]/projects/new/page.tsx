"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Spinner, inputClass } from "@/components/ui";

export default function NewProjectPage() {
  const params = useParams();
  const spaceId = params.spaceId as string;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [learningGoal, setLearningGoal] = useState("");
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
      const res = await fetch(`/api/spaces/${spaceId}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          learning_goal: learningGoal.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create project");
        setLoading(false);
        return;
      }
      const project = await res.json();
      router.push(`/projects/${project.id}`);
      router.refresh();
    } catch {
      setError("Failed to create project");
      setLoading(false);
    }
  }

  return (
    <div className="page-enter max-w-2xl">
      <p className="mb-4 text-sm text-stone-500">Upload materials, chat with the tutor and track mastery.</p>
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
              placeholder="e.g. Photosynthesis deep-dive"
              disabled={loading}
            />
          </Field>
          <Field label="Description" hint="Optional — what this project covers.">
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={inputClass}
              disabled={loading}
            />
          </Field>
          <Field label="Learning goal" hint="Optional — the tutor and recommendations use this to stay relevant.">
            <textarea
              id="learning_goal"
              value={learningGoal}
              onChange={(e) => setLearningGoal(e.target.value)}
              rows={2}
              className={inputClass}
              disabled={loading}
              placeholder="What do you want to learn from this project?"
            />
          </Field>
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={loading}>
              {loading && <Spinner className="text-white" />}
              {loading ? "Creating…" : "Create Project"}
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