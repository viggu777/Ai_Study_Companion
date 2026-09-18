"use client";

import { useState } from "react";
import { createClient } from "@/lib/auth/supabase/client";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import { Alert, Button, Field, Spinner, inputClass } from "@/components/ui";

export const dynamic = "force-dynamic";

const TOPIC_CHIPS = ["Exam prep", "Biology 101", "Interview prep", "Spanish"];

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Post-signup onboarding: name the first Space (skippable).
  // "verify" is shown when Supabase has "Confirm email" ON — signUp then
  // returns a user but NO session until the email link is clicked, so
  // onboarding (which POSTs /api/spaces) would 401. We show a check-inbox
  // notice instead.
  const [step, setStep] = useState<"form" | "onboarding" | "verify">("form");
  const [topic, setTopic] = useState("");
  const [topicError, setTopicError] = useState("");
  const [topicLoading, setTopicLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const displayName = name.trim();
    if (!displayName) {
      setError("Please enter your name");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    // No session + unconfirmed email => Supabase is waiting for email
    // verification. Show the check-inbox step instead of onboarding.
    if (!data.session && !(data.user as { email_confirmed_at?: string | null } | null)?.email_confirmed_at) {
      setStep("verify");
      return;
    }
    setStep("onboarding");
    router.refresh();
  }

  async function handleTopicSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTopicError("");
    const spaceName = topic.trim();
    if (!spaceName) {
      setTopicError("Type what you're learning, or skip for now");
      return;
    }
    setTopicLoading(true);
    try {
      // Same creation path as Spaces → New Space (POST /api/spaces).
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: spaceName }),
      });
      const data = (await res.json().catch(() => null)) as { id?: unknown; error?: unknown } | null;
      if (!res.ok || typeof data?.id !== "string") {
        throw new Error(typeof data?.error === "string" ? data.error : "Couldn't create your space");
      }
      router.push(`/spaces/${data.id}`);
      router.refresh();
    } catch (err) {
      setTopicError(err instanceof Error ? err.message : "Couldn't create your space");
      setTopicLoading(false);
    }
  }

  function handleSkip() {
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <AuthShell
      title={
        step === "form"
          ? "Create your account"
          : step === "verify"
            ? "Check your inbox"
            : `Nice to meet you${name.trim() ? `, ${name.trim().split(" ")[0]}` : ""}`
      }
      subtitle={
        step === "form" ? (
          "Start your first space in under a minute."
        ) : step === "verify" ? (
          <>
            Your account is created. <span className="font-medium text-stone-700">Verify your email to continue.</span>
          </>
        ) : (
          <>
            Your account is ready. <span className="font-medium text-stone-700">What are you learning?</span>
          </>
        )
      }
      switchText="Protected by Supabase Auth · your data stays isolated per account"
      switchHref="/login"
      switchLabel="Sign in"
      panelTitle="Answers from your material, not thin air."
      panelSubtitle="Upload a PDF, ask the Tutor anything, and every answer cites the exact page it came from."
    >
      {step === "form" ? (
        <form onSubmit={handleSignup} className="space-y-5">
          {error && <Alert>{error}</Alert>}
          <Field label="Name">
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="Your name"
              disabled={loading}
              maxLength={60}
            />
          </Field>
          <Field label="Email address">
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@example.com"
              disabled={loading}
            />
          </Field>
          <Field label="Password" hint="Minimum 8 characters">
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="Choose a password"
              disabled={loading}
            />
          </Field>
          <Field label="Confirm password">
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
              placeholder="Repeat your password"
              disabled={loading}
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading && <Spinner className="text-white" />}
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>
      ) : step === "verify" ? (
        <div className="space-y-5">
          <div className="rounded-lg border border-sky-600/20 bg-sky-600/5 px-4 py-3 text-sm text-stone-700" role="status">
            We sent a verification link to <span className="font-medium text-stone-900">{email}</span>. Click the
            link in that email, then sign in — no approval or waiting needed beyond that click.
          </div>
          <Button size="lg" className="w-full" onClick={() => router.push("/login")}>
            Go to sign in
          </Button>
          <button
            type="button"
            onClick={() => setStep("form")}
            className="w-full text-center text-sm font-medium text-stone-500 transition-colors hover:text-stone-900"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={handleTopicSubmit} className="space-y-5">
          {topicError && <Alert>{topicError}</Alert>}
          <Field label="What are you learning?" hint="This becomes your first Space — you can rename it later.">
            <input
              id="topic"
              name="topic"
              type="text"
              autoComplete="off"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className={inputClass}
              placeholder="e.g. Cell biology"
              disabled={topicLoading}
              maxLength={120}
              autoFocus
            />
          </Field>
          <div className="flex flex-wrap gap-2" aria-label="Examples">
            {TOPIC_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setTopic(chip)}
                disabled={topicLoading}
                className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-stone-400 hover:bg-stone-50 disabled:opacity-50"
              >
                {chip}
              </button>
            ))}
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={topicLoading}>
            {topicLoading && <Spinner className="text-white" />}
            {topicLoading ? "Creating your space…" : "Continue"}
          </Button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={topicLoading}
            className="w-full text-center text-sm font-medium text-stone-500 transition-colors hover:text-stone-900 disabled:opacity-50"
          >
            Skip for now
          </button>
        </form>
      )}
    </AuthShell>
  );
}
