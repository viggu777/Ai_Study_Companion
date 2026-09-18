"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIcon,
  ArrowRightIcon,
  BookIcon,
  CardsIcon,
  ChartIcon,
  ChatIcon,
  ChevronUpIcon,
  ConceptsIcon,
  CpuIcon,
  DashboardIcon,
  FlaskIcon,
  FolderIcon,
  JobsIcon,
  LogoutIcon,
  PlusIcon,
  QuizIcon,
  SparkIcon,
  TargetIcon,
  TrendUpIcon,
  UsersIcon,
} from "./icons";
import { avatarTone, initialOf } from "./avatar";

interface SidebarProps {
  userEmail: string | null;
  userName: string;
  onDisplayNameChange: (next: string) => void;
  isAdmin: boolean;
  /** mobile drawer state is controlled by AppShell (hamburger lives in TopBar) */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

interface NavItem {
  href: string;
  label: string;
  icon: (props: { className?: string }) => JSX.Element;
  /** when true, only an exact pathname match counts as active */
  exact?: boolean;
}

export const SIDEBAR_WIDTH_FULL = 264;
export const SIDEBAR_WIDTH_COLLAPSED = 72;
const SIDEBAR_STORAGE_KEY = "asc:sidebar-collapsed";
const SIDEBAR_TOGGLE_EVENT = "asc:sidebar-toggle";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Shared collapsed state for the main nav sidebar. Persisted to localStorage
 * so it survives navigation, and synced across mounted instances via a
 * window event (Sidebar + AppShell content offset stay in step).
 *
 * NOTE: the setter performs localStorage + dispatch OUTSIDE the React state
 * updater (updaters must be pure — side-effects inside them run twice under
 * StrictMode and made the toggle appear broken).
 */
export function useSidebarCollapsed(): [boolean, (next: boolean | ((v: boolean) => boolean)) => void] {
  const [collapsed, setCollapsedState] = useState<boolean>(false);
  const collapsedRef = useRef<boolean>(false);

  useEffect(() => {
    const initial = readCollapsed();
    collapsedRef.current = initial;
    setCollapsedState(initial);
    const onToggle = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      const value = typeof detail === "boolean" ? detail : readCollapsed();
      collapsedRef.current = value;
      setCollapsedState(value);
    };
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, onToggle);
    // Cross-tab sync (e.g. two windows open side by side).
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SIDEBAR_STORAGE_KEY) return;
      const value = e.newValue === "1";
      collapsedRef.current = value;
      setCollapsedState(value);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SIDEBAR_TOGGLE_EVENT, onToggle);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setCollapsed = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    const prev = collapsedRef.current;
    const value = typeof next === "function" ? (next as (v: boolean) => boolean)(prev) : next;
    collapsedRef.current = value;
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, value ? "1" : "0");
    } catch {
      // storage unavailable — collapse still works for the session
    }
    setCollapsedState(value);
    window.dispatchEvent(new CustomEvent<boolean>(SIDEBAR_TOGGLE_EVENT, { detail: value }));
  }, []);

  return [collapsed, setCollapsed];
}

/**
 * Workspace section — normal users only. Profile lives in the TopBar avatar
 * menu (+ the profile card below), so it is not a nav tab. Admins work from
 * the Administration section and don't need the user Dashboard / New Space.
 */
function workspaceNavItems(isAdmin: boolean): NavItem[] {
  if (isAdmin) return [];
  return [
    { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
    { href: "/spaces/new", label: "New Space", icon: PlusIcon },
  ];
}

const adminNav: NavItem[] = [
  { href: "/admin/dashboard", label: "Overview", icon: DashboardIcon },
  { href: "/admin/users", label: "Users", icon: UsersIcon },
  { href: "/admin/spaces", label: "Spaces", icon: FolderIcon },
  { href: "/admin/projects", label: "Projects", icon: BookIcon },
  { href: "/admin/activity", label: "Activity", icon: ActivityIcon },
  { href: "/admin/ai-usage", label: "AI Usage", icon: CpuIcon },
  { href: "/admin/ai-evaluation", label: "AI Evaluation", icon: FlaskIcon },
  { href: "/admin/jobs", label: "Jobs", icon: JobsIcon },
  { href: "/admin/health", label: "System Health", icon: ActivityIcon },
];

function projectNav(projectId: string): NavItem[] {
  const base = `/projects/${projectId}`;
  return [
    { href: base, label: "Overview", icon: DashboardIcon, exact: true },
    { href: `${base}/materials`, label: "Materials", icon: BookIcon },
    { href: `${base}/tutor`, label: "Tutor", icon: ChatIcon },
    { href: `${base}/flashcards`, label: "Flashcards", icon: CardsIcon },
    { href: `${base}/concepts`, label: "Concepts", icon: ConceptsIcon },
    { href: `${base}/quiz`, label: "Quiz", icon: QuizIcon },
    { href: `${base}/mastery`, label: "Mastery", icon: TargetIcon },
    { href: `${base}/growth`, label: "Growth", icon: TrendUpIcon },
    { href: `${base}/analytics`, label: "Analytics", icon: ChartIcon },
    { href: `${base}/recommendations`, label: "Recommendations", icon: SparkIcon },
  ];
}

function NavSection({
  title,
  items,
  pathname,
  collapsed,
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  return (
    <div>
      {collapsed ? (
        <div aria-hidden className="mx-2 mb-1.5 border-b border-stone-200" />
      ) : (
        <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
          {title}
        </p>
      )}
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={cx(
                  "group relative flex items-center rounded-lg text-[13.5px] font-medium transition-all",
                  collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2",
                  active
                    ? "bg-sky-600/10 text-sky-900 ring-1 ring-inset ring-sky-600/20"
                    : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                )}
              >
                <Icon
                  className={cx(
                    "h-[18px] w-[18px] shrink-0 transition-colors",
                    active ? "text-sky-700" : "text-stone-400 group-hover:text-stone-700"
                  )}
                />
                {!collapsed && item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Sidebar({ userEmail, userName, onDisplayNameChange, isAdmin, mobileOpen, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [profileOpen, setProfileOpen] = useState(false);
  const [draftName, setDraftName] = useState(userName);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const close = () => onCloseMobile();

  // Close the mobile drawer + profile card on navigation.
  useEffect(() => {
    setProfileOpen(false);
    onCloseMobile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  const projectId = projectMatch ? decodeURIComponent(projectMatch[1]) : null;
  // Brand home: admins land on the admin overview, users on their dashboard.
  const homeHref = isAdmin ? "/admin/dashboard" : "/dashboard";
  const workspaceItems = workspaceNavItems(isAdmin);
  const tone = avatarTone(userEmail ?? userName);
  const initial = initialOf(userName);

  const openProfile = () => {
    setDraftName(userName);
    setSaveError(null);
    setProfileOpen(true);
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Even if the call fails, force a logged-out transition —
      // middleware + page guards redirect to /login without a session.
    } finally {
      // Full navigation (not router.push): clears RSC cache + client state
      // so no authenticated UI flashes after logout.
      window.location.href = "/login";
    }
  };

  const saveName = async () => {
    const next = draftName.trim();
    if (!next || next === userName || saving) return;
    setSaving(true);
    setSaveError(null);
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
      onDisplayNameChange(body.display_name);
      setProfileOpen(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save name");
    } finally {
      setSaving(false);
    }
  };

  const sidebarBody = (
    <div className="flex h-full flex-col">
      {collapsed ? (
        <Link
          href={homeHref}
          onClick={close}
          className="flex items-center justify-center px-2 pb-5 pt-5"
          title="AI Study Companion"
          aria-label="AI Study Companion"
        >
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-sky-600/10 text-base font-bold text-sky-700 ring-1 ring-inset ring-sky-600/20"
          >
            A
          </span>
        </Link>
      ) : (
        <div className="px-4 pb-5 pt-5">
          <div className="flex items-start justify-between gap-2">
            <Link href={homeHref} onClick={close} className="flex items-center gap-2.5" title="Workspace home">
              <span
                aria-hidden
                className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-sky-600/10 text-base font-bold text-sky-700 ring-1 ring-inset ring-sky-600/20"
              >
                A
              </span>
              <span className="leading-tight">
                <span className="block text-[14px] font-semibold tracking-tight text-stone-900">AI Study</span>
                <span className="block text-[14px] font-semibold tracking-tight text-stone-900">Companion</span>
              </span>
            </Link>
            {/* Mobile drawer close — collapse toggle is desktop-only (lg+), so
                small screens need an explicit dismiss control. */}
            <button
              type="button"
              onClick={close}
              aria-label="Close navigation"
              className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 lg:hidden"
            >
              <span aria-hidden className="block text-lg leading-none">×</span>
            </button>
          </div>
          {/* NOTE: no "Back to space" link here — the sidebar never knows the
              parent space id, so the previous link pointed at /dashboard while
              claiming to go to the space. The project Overview page renders
              the real back-link (with the space name) instead. */}
        </div>
      )}

      <nav
        aria-label="Main navigation"
        className={cx(
          "flex-1 space-y-6 overflow-y-auto pb-4",
          collapsed ? "px-2" : "px-3"
        )}
      >
        {workspaceItems.length > 0 && (
          <NavSection title="Workspace" items={workspaceItems} pathname={pathname} collapsed={collapsed} onNavigate={close} />
        )}
        {projectId && (
          <NavSection title="Project" items={projectNav(projectId)} pathname={pathname} collapsed={collapsed} onNavigate={close} />
        )}
        {isAdmin && (
          <NavSection title="Administration" items={adminNav} pathname={pathname} collapsed={collapsed} onNavigate={close} />
        )}
      </nav>

      <div className={cx("relative border-t border-stone-200", collapsed ? "p-2" : "p-3")}>
        {/* Profile card popover — name, email + editable display name */}
        {profileOpen && (
          <>
            <button
              type="button"
              aria-label="Close profile"
              onClick={() => setProfileOpen(false)}
              className="fixed inset-0 z-40 cursor-default bg-transparent"
            />
            <div
              role="dialog"
              aria-label="Profile"
              className="absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-card-hover"
            >
              <div className="flex items-center gap-3 p-4">
                <span
                  aria-hidden
                  className={cx(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1 ring-inset",
                    tone.bg,
                    tone.text,
                    tone.ring
                  )}
                >
                  {initial}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-900" title={userName}>
                    {userName}
                  </p>
                  {userEmail && (
                    <p className="truncate text-xs text-stone-400" title={userEmail}>
                      {userEmail}
                    </p>
                  )}
                </div>
              </div>
              <div className="border-t border-stone-100 p-4 pt-3">
                <label htmlFor="asc-display-name" className="mb-1.5 block text-xs font-medium text-stone-700">
                  Display name
                </label>
                <input
                  id="asc-display-name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveName();
                    } else if (e.key === "Escape") {
                      setProfileOpen(false);
                    }
                  }}
                  maxLength={60}
                  placeholder="Your name"
                  className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-sky-600 focus:outline-none"
                />
                {saveError && (
                  <p role="alert" className="mt-1.5 text-xs text-red-600">
                    {saveError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void saveName()}
                  disabled={saving || !draftName.trim() || draftName.trim() === userName}
                  className="mt-2.5 w-full rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save name"}
                </button>
                <Link
                  href="/profile"
                  onClick={close}
                  className="mt-2 block w-full rounded-lg border border-stone-200 px-3 py-1.5 text-center text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50"
                >
                  View full profile
                </Link>
              </div>
            </div>
          </>
        )}
        <button
          type="button"
          onClick={() => (profileOpen ? setProfileOpen(false) : openProfile())}
          aria-expanded={profileOpen}
          aria-label="Open profile"
          title={collapsed ? userName : undefined}
          className={cx(
            "flex w-full items-center gap-2.5 rounded-lg py-2 text-left transition-colors hover:bg-stone-100",
            collapsed ? "justify-center px-0" : "px-2"
          )}
        >
          <span
            aria-hidden
            className={cx(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset",
              tone.bg,
              tone.text,
              tone.ring
            )}
          >
            {initial}
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-stone-900" title={userName}>
                {userName}
              </span>
              {userEmail && (
                <span className="block truncate text-xs text-stone-400" title={userEmail}>
                  {userEmail}
                </span>
              )}
            </span>
          )}
          {!collapsed && (
            <ChevronUpIcon
              className={cx("h-4 w-4 shrink-0 text-stone-400 transition-transform", profileOpen && "rotate-180")}
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
          title={collapsed ? "Logout" : undefined}
          aria-label={collapsed ? "Logout" : undefined}
          className={cx(
            "mt-1 flex w-full items-center rounded-lg text-[13.5px] font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:opacity-60",
            collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2"
          )}
        >
          <LogoutIcon className="h-[18px] w-[18px]" />
          {!collapsed && (loggingOut ? "Signing out…" : "Logout")}
        </button>
        {/* Collapse toggle — desktop-only. The collapsed rail width only applies
            at lg+, so showing this toggle on mobile made it look broken
            (tapping it changed state with zero visible effect). */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cx(
            "mt-1 hidden w-full items-center rounded-lg text-[13.5px] font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 lg:flex",
            collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2"
          )}
        >
          <span
            aria-hidden
            className={cx("inline-block transition-transform duration-200", collapsed ? "rotate-180" : "")}
          >
            <ArrowRightIcon className="h-[18px] w-[18px] rotate-180" />
          </span>
          {!collapsed && "Collapse"}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fade-enter fixed inset-0 z-30 bg-stone-900/40 backdrop-blur-[2px] lg:hidden"
          onClick={close}
          aria-hidden
        />
      )}

      {/* Sidebar panel — full width by default, icon-only rail when collapsed (desktop) */}
      <aside
        aria-label="Sidebar"
        data-collapsed={collapsed ? "true" : "false"}
        className={cx(
          "fixed inset-y-0 left-0 z-40 w-[264px] transform border-r border-stone-200 bg-white shadow-2xl transition-all duration-200 ease-out lg:translate-x-0 lg:shadow-none",
          collapsed && "lg:w-[72px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarBody}
      </aside>
    </>
  );
}
