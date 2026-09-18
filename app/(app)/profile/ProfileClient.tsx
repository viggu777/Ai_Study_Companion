"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card } from "@/components/ui";
import { avatarTone, initialOf } from "@/components/avatar";

export default function ProfileClient({
  initialName,
  email,
  createdAt,
  isAdmin,
}: {
  initialName: string;
  email: string | null;
  createdAt: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passMsg, setPassMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingPass, setSavingPass] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const tone = avatarTone(email ?? initialName);

  const saveName = async () => {
    const next = name.trim();
    if (!next || next === initialName || savingName) return;
    setSavingName(true);
    setNameMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: next }),
      });
      const body = (await res.json().catch(() => null)) as { display_name?: unknown; error?: unknown } | null;
      if (!res.ok || typeof body?.display_name !== "string") {
        throw new Error(typeof body?.error === "string" ? body.error : "Failed to save name");
      }
      setNameMsg({ ok: true, text: "Display name updated." });
      router.refresh();
    } catch (e) {
      setNameMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to save name" });
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async () => {
    setPassMsg(null);
    if (newPassword.length < 6) {
      setPassMsg({ ok: false, text: "Password must be at least 6 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPassMsg({ ok: false, text: "Passwords do not match." });
      return;
    }
    setSavingPass(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : "Failed to update password");
      }
      setPassMsg({ ok: true, text: "Password updated successfully." });
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      setPassMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to update password" });
    } finally {
      setSavingPass(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Identity card */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold ring-1 ring-inset ${tone.bg} ${tone.text} ${tone.ring}`}
          >
            {initialOf(name || initialName)}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight text-stone-900">{name || initialName}</h2>
            {email && <p className="truncate text-sm text-stone-500">{email}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {isAdmin && (
                <span className="rounded-full bg-violet-600/10 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-600/20">
                  Admin
                </span>
              )}
              {createdAt && (
                <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-medium text-stone-500">
                  Member since {new Date(createdAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Display name */}
      <Card className="p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-stone-900">Display name</h2>
        <p className="mt-0.5 text-sm text-stone-500">Shown in the sidebar, top bar and anywhere your name appears.</p>
        <label htmlFor="profile-display-name" className="mb-1.5 mt-4 block text-xs font-medium text-stone-700">
          Name
        </label>
        <input
          id="profile-display-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void saveName();
            }
          }}
          maxLength={60}
          placeholder="Your name"
          autoComplete="name"
          className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-sky-600 focus:outline-none"
        />
        {nameMsg && (
          <div className="mt-3" role={nameMsg.ok ? "status" : "alert"}>
            {nameMsg.ok ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{nameMsg.text}</p>
            ) : (
              <Alert>{nameMsg.text}</Alert>
            )}
          </div>
        )}
        <div className="mt-4">
          <Button onClick={() => void saveName()} disabled={savingName || !name.trim() || name.trim() === initialName}>
            {savingName ? "Saving…" : "Save name"}
          </Button>
        </div>
      </Card>

      {/* Password */}
      <Card className="p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-stone-900">Password</h2>
        <p className="mt-0.5 text-sm text-stone-500">Use at least 6 characters. You stay signed in on this device after changing it.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="profile-new-password" className="mb-1.5 block text-xs font-medium text-stone-700">
              New password
            </label>
            <input
              id="profile-new-password"
              type={showPw ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="••••••••"
              className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-sky-600 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="profile-confirm-password" className="mb-1.5 block text-xs font-medium text-stone-700">
              Confirm new password
            </label>
            <input
              id="profile-confirm-password"
              type={showPw ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void savePassword();
                }
              }}
              autoComplete="new-password"
              placeholder="••••••••"
              className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-sky-600 focus:outline-none"
            />
          </div>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-600">
          <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} className="h-3.5 w-3.5 accent-sky-600" />
          Show passwords
        </label>
        {passMsg && (
          <div className="mt-3" role={passMsg.ok ? "status" : "alert"}>
            {passMsg.ok ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{passMsg.text}</p>
            ) : (
              <Alert>{passMsg.text}</Alert>
            )}
          </div>
        )}
        <div className="mt-4">
          <Button
            onClick={() => void savePassword()}
            disabled={savingPass || !newPassword || !confirmPassword}
            variant="secondary"
          >
            {savingPass ? "Updating…" : "Update password"}
          </Button>
        </div>
      </Card>

      {/* Account */}
      <Card className="p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-stone-900">Account</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-stone-500">Email</dt>
            <dd className="truncate font-medium text-stone-900">{email ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-stone-500">Role</dt>
            <dd className="font-medium text-stone-900">{isAdmin ? "Admin" : "Learner"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-stone-400">
          Email changes are not available here — contact an administrator if you need to update your sign-in email.
        </p>
      </Card>
    </div>
  );
}
