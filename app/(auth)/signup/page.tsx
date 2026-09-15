"use client";

import { useState } from "react";
import { createClient } from "@/lib/auth/supabase/client";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import { Alert, Button, Field, Spinner, inputClass } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signUp({
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
      title="Create your account"
      subtitle="Start your first space in under a minute."
      switchText="Protected by Supabase Auth · your data stays isolated per account"
      switchHref="/login"
      switchLabel="Sign in"
    >
      <form onSubmit={handleSignup} className="space-y-5">
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
    </AuthShell>
  );
}
