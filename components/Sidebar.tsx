"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ActivityIcon,
  BookIcon,
  ChartIcon,
  ChatIcon,
  CloseIcon,
  CpuIcon,
  DashboardIcon,
  FlaskIcon,
  FolderIcon,
  JobsIcon,
  LogoutIcon,
  MenuIcon,
  PlusIcon,
  QuizIcon,
  SparkIcon,
  TargetIcon,
  TrendUpIcon,
  UsersIcon,
} from "./icons";

interface SidebarProps {
  userEmail: string | null;
  isAdmin: boolean;
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

const workspaceNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/spaces/new", label: "New Space", icon: PlusIcon },
];

const adminNav: NavItem[] = [
  { href: "/admin/dashboard", label: "Overview", icon: DashboardIcon },
  { href: "/admin/users", label: "Users", icon: UsersIcon },
  { href: "/admin/projects", label: "Projects", icon: FolderIcon },
  { href: "/admin/activity", label: "Activity", icon: ActivityIcon },
  { href: "/admin/ai-usage", label: "AI Usage", icon: CpuIcon },
  { href: "/admin/ai-evaluation", label: "AI Evaluation", icon: FlaskIcon },
  { href: "/admin/jobs", label: "Jobs", icon: JobsIcon },
];

function projectNav(projectId: string): NavItem[] {
  const base = `/projects/${projectId}`;
  return [
    { href: base, label: "Overview", icon: DashboardIcon, exact: true },
    { href: `${base}/materials`, label: "Materials", icon: BookIcon },
    { href: `${base}/tutor`, label: "Tutor", icon: ChatIcon },
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
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <div>
      <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200/50">
        {title}
      </p>
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
                className={cx(
                  "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-all",
                  active
                    ? "bg-emerald-800 text-white shadow-card"
                    : "text-emerald-100/70 hover:bg-white/[0.06] hover:text-white"
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-emerald-300 transition-opacity",
                    active ? "opacity-100" : "opacity-0"
                  )}
                />
                <Icon
                  className={cx(
                    "h-[18px] w-[18px] shrink-0 transition-colors",
                    active ? "text-emerald-200" : "text-emerald-100/45 group-hover:text-emerald-100/80"
                  )}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Sidebar({ userEmail, isAdmin }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  const projectId = projectMatch ? decodeURIComponent(projectMatch[1]) : null;
  const initial = (userEmail?.trim().charAt(0) ?? "?").toUpperCase();

  const sidebarBody = (
    <div className="flex h-full flex-col">
      <Link href="/dashboard" onClick={close} className="flex items-center gap-2.5 px-4 pb-5 pt-5">
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-emerald-400 to-emerald-700 text-base font-bold text-white shadow-card"
        >
          A
        </span>
        <span className="leading-tight">
          <span className="block text-[14px] font-semibold tracking-tight text-white">AI Study</span>
          <span className="block text-[14px] font-semibold tracking-tight text-white">Companion</span>
        </span>
      </Link>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        <NavSection title="Workspace" items={workspaceNav} pathname={pathname} onNavigate={close} />
        {projectId && (
          <NavSection title="Project" items={projectNav(projectId)} pathname={pathname} onNavigate={close} />
        )}
        {isAdmin && (
          <NavSection title="Administration" items={adminNav} pathname={pathname} onNavigate={close} />
        )}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-semibold text-emerald-50"
          >
            {initial}
          </span>
          {userEmail && (
            <p className="min-w-0 flex-1 truncate text-xs text-emerald-100/70" title={userEmail}>
              {userEmail}
            </p>
          )}
        </div>
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium text-emerald-100/70 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <LogoutIcon className="h-[18px] w-[18px]" />
            Logout
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-emerald-900 bg-emerald-950/95 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
          aria-expanded={open}
          className="rounded-lg p-2 text-emerald-100 transition-colors hover:bg-white/10"
        >
          {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
        </button>
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight text-white">
          AI Study Companion
        </Link>
      </div>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fade-enter fixed inset-0 z-30 bg-emerald-950/60 backdrop-blur-[2px] lg:hidden"
          onClick={close}
          aria-hidden
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 w-[264px] transform bg-emerald-950 shadow-2xl transition-transform duration-200 ease-out lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarBody}
      </aside>
    </>
  );
}
