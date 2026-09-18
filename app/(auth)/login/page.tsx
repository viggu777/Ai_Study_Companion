"use client";

import { useState } from "react";
import { createClient } from "@/lib/auth/supabase/client";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import { Alert, Button, Field, Spinner, inputClass } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <AuthShell
      title="Pick up where you left off"
      subtitle="Your spaces, Tutor threads, and mastery are waiting."
      switchText="Protected by Supabase Auth · your data stays isolated per account"
      switchHref="/signup"
      switchLabel="Create an account"
      panelTitle="Continue learning, right where you stopped."
      panelSubtitle="Your spaces, weakest concepts, and next actions are saved — sign in and keep going."
    >
      <form onSubmit={handleLogin} className="space-y-5">
        {error && <Alert>{error}</Alert>}
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
        <Field label="Password">
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="Your password"
            disabled={loading}
          />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading && <Spinner className="text-white" />}
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
