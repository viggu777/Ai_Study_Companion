"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BellIcon, MenuIcon, SearchIcon } from "./icons";
import { avatarTone, initialOf } from "./avatar";

export interface Crumb {
  label: string;
  href?: string;
}

const PROJECT_PAGES = [
  { slug: "", label: "Overview" },
  { slug: "materials", label: "Materials" },
  { slug: "tutor", label: "Tutor" },
  { slug: "flashcards", label: "Flashcards" },
  { slug: "concepts", label: "Concepts" },
  { slug: "quiz", label: "Quiz" },
  { slug: "mastery", label: "Mastery" },
  { slug: "growth", label: "Growth" },
  { slug: "analytics", label: "Analytics" },
  { slug: "recommendations", label: "Recommendations" },
] as const;

const ADMIN_PAGES = [
  { slug: "dashboard", label: "Overview" },
  { slug: "users", label: "Users" },
  { slug: "projects", label: "Projects" },
  { slug: "activity", label: "Activity" },
  { slug: "ai-usage", label: "AI Usage" },
  { slug: "ai-evaluation", label: "AI Evaluation" },
  { slug: "jobs", label: "Jobs" },
  { slug: "health", label: "System Health" },
] as const;

interface NameCache {
  projects: Record<string, { name: string; spaceId: string | null }>;
  spaces: Record<string, string>;
}

// Module-level caches survive client-side navigations AND component remounts
// (component state alone was wiped on every full-page reload, forcing a
// refetch of project/space names on each transition). Inflight dedupe avoids
// firing the same API twice when pathname changes quickly.
const globalNameCache: NameCache = { projects: {}, spaces: {} };
const inflight = new Map<string, Promise<Record<string, unknown> | null>>();

function loadCached(key: "project" | "space", id: string): void {
  try {
    if (key === "project" && !globalNameCache.projects[id]) {
      const raw = window.localStorage.getItem(`asc:name:project:${id}`);
      if (raw) globalNameCache.projects[id] = JSON.parse(raw);
    }
    if (key === "space" && !globalNameCache.spaces[id]) {
      const raw = window.localStorage.getItem(`asc:name:space:${id}`);
      if (raw) globalNameCache.spaces[id] = JSON.parse(raw);
    }
  } catch {
    // storage unavailable — memory cache still works
  }
}

function storeCached(key: "project" | "space", id: string, value: { name: string; spaceId: string | null } | string): void {
  try {
    window.localStorage.setItem(`asc:name:${key}:${id}`, JSON.stringify(value));
  } catch {
    // ignore quota/private-mode errors
  }
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

/**
 * Global top bar — hamburger (mobile), breadcrumb with real space/project
 * names, ⌘K page-jump search, notification bell (empty stub until a
 * notifications system exists), and the user's avatar.
 */
export function TopBar({
  userEmail,
  userName,
  isAdmin,
  onMenu,
}: {
  userEmail: string | null;
  userName: string;
  isAdmin: boolean;
  onMenu: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [names, setNames] = useState<NameCache>({ projects: {}, spaces: {} });
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const projectMatch = pathname.match(/^\/projects\/([^/]+)(?:\/(.*))?$/);
  const projectId = projectMatch ? decodeURIComponent(projectMatch[1]) : null;
  const projectSub = projectMatch?.[2] ?? "";
  const spaceMatch = pathname.match(/^\/spaces\/([^/]+)(?:\/(.*))?$/);
  const spaceId = spaceMatch ? decodeURIComponent(spaceMatch[1]) : null;
  const spaceSub = spaceMatch?.[2] ?? "";

  // Resolve real space/project names (ownership-checked APIs), cached per id.
  // Seed from the module-level (+localStorage) cache so back/forward and
  // remounts render instantly with zero fetches; only truly-unknown ids hit
  // the network, deduped via `inflight`.
  useEffect(() => {
    if (projectId) loadCached("project", projectId);
    if (spaceId) loadCached("space", spaceId);
    const proj = projectId ? globalNameCache.projects[projectId] : undefined;
    const sp = spaceId ? globalNameCache.spaces[spaceId] : undefined;
    // Also seed a linked space id when the project entry already knows it.
    if (proj?.spaceId) loadCached("space", proj.spaceId);
    const linkedSpace =
      proj?.spaceId ? globalNameCache.spaces[proj.spaceId] : undefined;
    setNames((prev) => {
      let next = prev;
      if (proj && !prev.projects[projectId!]) {
        next = { ...next, projects: { ...next.projects, [projectId!]: proj } };
      }
      if (sp && spaceId && !prev.spaces[spaceId]) {
        next = { ...next, spaces: { ...next.spaces, [spaceId]: sp } };
      }
      if (proj?.spaceId && linkedSpace && !next.spaces[proj.spaceId]) {
        next = { ...next, spaces: { ...next.spaces, [proj.spaceId]: linkedSpace } };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, spaceId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const needProject = projectId && !globalNameCache.projects[projectId];
      const needSpace = spaceId && !globalNameCache.spaces[spaceId];
      // Fetch unknown ids in parallel (project + space are independent when
      // the URL already carries the space id).
      const [p, s] = await Promise.all([
        needProject
          ? fetchJson(`/api/projects/${encodeURIComponent(projectId!)}`)
          : Promise.resolve(null),
        needSpace
          ? fetchJson(`/api/spaces/${encodeURIComponent(spaceId!)}`)
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (needProject && p) {
        const name = typeof p?.name === "string" ? p.name : "Project";
        const sid = typeof p?.space_id === "string" ? p.space_id : null;
        const entry = { name, spaceId: sid };
        globalNameCache.projects[projectId!] = entry;
        storeCached("project", projectId!, entry);
        setNames((prev) =>
          prev.projects[projectId!] ? prev : { ...prev, projects: { ...prev.projects, [projectId!]: entry } }
        );
        // Linked space name: serve from cache when possible, else one fetch.
        if (sid && !globalNameCache.spaces[sid]) {
          const linked = await fetchJson(`/api/spaces/${encodeURIComponent(sid)}`);
          if (cancelled) return;
          if (typeof linked?.name === "string") {
            globalNameCache.spaces[sid] = linked.name as string;
            storeCached("space", sid, linked.name as string);
            setNames((prev) =>
              prev.spaces[sid] ? prev : { ...prev, spaces: { ...prev.spaces, [sid]: linked.name as string } }
            );
          }
        } else if (sid && globalNameCache.spaces[sid]) {
          const cached = globalNameCache.spaces[sid];
          setNames((prev) =>
            prev.spaces[sid] ? prev : { ...prev, spaces: { ...prev.spaces, [sid]: cached } }
          );
        }
      }
      if (needSpace && s && typeof s?.name === "string" && spaceId) {
        globalNameCache.spaces[spaceId] = s.name as string;
        storeCached("space", spaceId, s.name as string);
        setNames((prev) =>
          prev.spaces[spaceId] ? prev : { ...prev, spaces: { ...prev.spaces, [spaceId]: s.name as string } }
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, spaceId]);

  const crumbs: Crumb[] = useMemo(() => {
    if (pathname === "/dashboard") return [{ label: "Dashboard" }];
    if (pathname === "/profile") return [{ label: "Profile" }];
    if (pathname === "/spaces/new") return [{ label: "Spaces", href: "/dashboard" }, { label: "New Space" }];
    if (spaceId) {
      const sName = names.spaces[spaceId] ?? "Space";
      const base: Crumb[] = [
        { label: "Spaces", href: "/dashboard" },
        { label: sName, href: `/spaces/${encodeURIComponent(spaceId)}` },
      ];
      if (spaceSub === "projects/new") base.push({ label: "New Project" });
      return base;
    }
    if (projectId) {
      const p = names.projects[projectId];
      const trail: Crumb[] = [];
      if (p?.spaceId) {
        trail.push({
          label: names.spaces[p.spaceId] ?? "Space",
          href: `/spaces/${encodeURIComponent(p.spaceId)}`,
        });
      }
      trail.push({ label: "Project", href: `/projects/${encodeURIComponent(projectId)}` });
      const page = PROJECT_PAGES.find((pg) => pg.slug === projectSub);
      trail.push({ label: page ? page.label : "Overview" });
      return trail;
    }
    if (pathname.startsWith("/admin")) {
      const rest = pathname.replace(/^\/admin\/?/, "");
      if (rest.startsWith("users/") && rest.length > "users/".length) {
        const userId = decodeURIComponent(rest.slice("users/".length).split("/")[0]);
        return [
          { label: "Admin", href: "/admin/dashboard" },
          { label: "Users", href: "/admin/users" },
          { label: userId.slice(0, 8) + "…" },
        ];
      }
      const page = ADMIN_PAGES.find((pg) => pg.slug === rest);
      return [
        { label: "Admin", href: "/admin/dashboard" },
        { label: page ? page.label : "Overview" },
      ];
    }
    return [{ label: "Dashboard", href: "/dashboard" }];
  }, [pathname, projectId, projectSub, spaceId, spaceSub, names]);

  // Page-jump destinations for the ⌘K search (all real, existing routes).
  // Admins jump between admin pages; the user Dashboard / New Space are
  // hidden for them (same as the sidebar).
  const destinations = useMemo(() => {
    const list: Array<{ label: string; hint: string; href: string }> = [];
    if (!isAdmin) {
      list.push(
        { label: "Dashboard", hint: "Workspace", href: "/dashboard" },
        { label: "New Space", hint: "Workspace", href: "/spaces/new" },
      );
    }
    if (projectId) {
      const base = `/projects/${encodeURIComponent(projectId)}`;
      for (const pg of PROJECT_PAGES) {
        list.push({ label: pg.label, hint: "Project", href: pg.slug ? `${base}/${pg.slug}` : base });
      }
    }
    if (isAdmin) {
      for (const pg of ADMIN_PAGES) {
        list.push({ label: `Admin · ${pg.label}`, hint: "Admin", href: `/admin/${pg.slug}` });
      }
    }
    return list;
  }, [projectId, isAdmin]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return destinations;
    return destinations.filter((d) => `${d.label} ${d.hint}`.toLowerCase().includes(q));
  }, [destinations, query]);

  // ⌘K / Ctrl+K focuses search; close dropdowns on navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setSearchOpen(false);
    setBellOpen(false);
    setProfileOpen(false);
    setQuery("");
  }, [pathname]);

  const go = (href: string) => {
    setSearchOpen(false);
    setQuery("");
    searchRef.current?.blur();
    router.push(href);
  };

  const initial = initialOf(userName);
  const tone = avatarTone(userEmail ?? userName);

  const handleMenuLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // fall through to hard navigation below
    } finally {
      window.location.href = "/login";
    }
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b border-stone-200/80 bg-white/85 px-4 backdrop-blur-md sm:gap-3 sm:px-6">
      {/* Accent hairline */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-sky-600 via-sky-400 to-teal-400" />
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open navigation"
        className="rounded-xl border border-transparent p-2 text-stone-600 transition-colors hover:border-stone-200 hover:bg-stone-100 lg:hidden"
      >
        <MenuIcon className="h-5 w-5" />
      </button>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1 text-[13px]">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
                {i > 0 && (
                  <span aria-hidden className="shrink-0 px-0.5 text-stone-300">
                    ›
                  </span>
                )}
                {c.href && !last ? (
                  <Link
                    href={c.href}
                    className="shrink-0 rounded-md px-1.5 py-1 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span
                    aria-current={last ? "page" : undefined}
                    className={
                      last
                        ? "truncate rounded-full bg-stone-900/[0.04] px-2.5 py-1 font-semibold text-stone-900 ring-1 ring-inset ring-stone-900/10"
                        : "truncate px-1.5 py-1 text-stone-500"
                    }
                  >
                    {c.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Search with ⌘K hint — jumps to real pages */}
      <div className="relative hidden shrink-0 md:block">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearchOpen(false);
              searchRef.current?.blur();
            } else if (e.key === "Enter" && matches.length > 0) {
              e.preventDefault();
              go(matches[0].href);
            }
          }}
          placeholder="Jump to page…"
          aria-label="Search pages"
          className="w-48 rounded-full border border-stone-200 bg-stone-100/70 py-2 pl-9 pr-12 text-[13px] text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600/15 lg:w-64"
        />
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-stone-400 lg:flex"
        >
          ⌘K
        </kbd>
        {searchOpen && (
          <>
            <button
              type="button"
              aria-label="Close search"
              onClick={() => setSearchOpen(false)}
              className="fixed inset-0 z-30 cursor-default bg-transparent"
            />
            <div className="absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-card-hover">
              <p className="border-b border-stone-100 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-400">
                Pages
              </p>
              {matches.length === 0 ? (
                <p className="px-3.5 py-3 text-[13px] text-stone-400">No matching pages.</p>
              ) : (
                <ul className="max-h-64 overflow-y-auto py-1">
                  {matches.map((m) => (
                    <li key={m.href + m.label}>
                      <button
                        type="button"
                        onClick={() => go(m.href)}
                        className="group flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] transition-colors hover:bg-sky-50"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-stone-900">{m.label}</span>
                        <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500 group-hover:bg-white">
                          {m.hint}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {/* Notifications */}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setBellOpen((v) => !v)}
          aria-label="Notifications"
          aria-expanded={bellOpen}
          title="Notifications"
          className="relative rounded-full border border-transparent p-2 text-stone-500 transition-colors hover:border-stone-200 hover:bg-stone-100 hover:text-stone-800"
        >
          <BellIcon className="h-5 w-5" />
          {/* No unread dot: there is no notifications system yet, so a
              permanent dot would fake unread state on every page. */}
        </button>
        {bellOpen && (
          <>
            <button
              type="button"
              aria-label="Close notifications"
              onClick={() => setBellOpen(false)}
              className="fixed inset-0 z-30 cursor-default bg-transparent"
            />
            <div className="absolute right-0 z-40 mt-2 w-72 rounded-2xl border border-stone-200 bg-white p-4 shadow-card-hover">
              <p className="text-[13px] font-semibold text-stone-900">Notifications</p>
              <p className="mt-1 text-xs leading-relaxed text-stone-500">You&apos;re all caught up — nothing new. Quiz reminders and new recommendations will show up here.</p>
            </div>
          </>
        )}
      </div>

      <span aria-hidden className="hidden h-6 w-px bg-stone-200 sm:block" />

      {/* Profile menu */}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setProfileOpen((v) => !v)}
          aria-label="Account menu"
          aria-expanded={profileOpen}
          title={userEmail ? `${userName} (${userEmail})` : userName}
          className="flex items-center gap-2 rounded-full border border-stone-200 bg-white py-1 pl-1 pr-2.5 shadow-sm transition-all hover:border-stone-300 hover:shadow"
        >
          <span
            aria-hidden
            className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ring-1 ring-inset ${tone.bg} ${tone.text} ${tone.ring}`}
          >
            {initial}
          </span>
          <span className="hidden max-w-28 truncate text-[13px] font-semibold text-stone-800 xl:block">{userName}</span>
        </button>
        {profileOpen && (
          <>
            <button
              type="button"
              aria-label="Close account menu"
              onClick={() => setProfileOpen(false)}
              className="fixed inset-0 z-30 cursor-default bg-transparent"
            />
            <div className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-card-hover">
              <div className="flex items-center gap-2.5 border-b border-stone-100 px-4 py-3">
                <span
                  aria-hidden
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ring-inset ${tone.bg} ${tone.text} ${tone.ring}`}
                >
                  {initial}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-900">{userName}</p>
                  {userEmail && <p className="truncate text-xs text-stone-400">{userEmail}</p>}
                </div>
              </div>
              <div className="p-1.5">
                <Link
                  href="/profile"
                  onClick={() => setProfileOpen(false)}
                  className="block rounded-lg px-3 py-2 text-[13px] font-medium text-stone-700 transition-colors hover:bg-stone-100"
                >
                  View profile & settings
                </Link>
                <button
                  type="button"
                  onClick={() => void handleMenuLogout()}
                  className="block w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium text-stone-600 transition-colors hover:bg-red-50 hover:text-red-700"
                >
                  Sign out
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
