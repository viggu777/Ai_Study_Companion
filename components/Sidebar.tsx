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
      <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
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
                    ? "bg-sky-600 text-white shadow-card"
                    : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                )}
              >
                <Icon
                  className={cx(
                    "h-[18px] w-[18px] shrink-0 transition-colors",
                    active ? "text-white" : "text-stone-400 group-hover:text-stone-700"
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
          className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-sky-600 text-base font-bold text-white shadow-card"
        >
          A
        </span>
        <span className="leading-tight">
          <span className="block text-[14px] font-semibold tracking-tight text-stone-900">AI Study</span>
          <span className="block text-[14px] font-semibold tracking-tight text-stone-900">Companion</span>
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

      <div className="border-t border-stone-200 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-600 text-xs font-semibold text-white"
          >
            {initial}
          </span>
          {userEmail && (
            <p className="min-w-0 flex-1 truncate text-xs text-stone-500" title={userEmail}>
              {userEmail}
            </p>
          )}
        </div>
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900"
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
      <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-stone-200 bg-white/95 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
          aria-expanded={open}
          className="rounded-lg p-2 text-stone-600 transition-colors hover:bg-stone-100"
        >
          {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
        </button>
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight text-stone-900">
          AI Study Companion
        </Link>
      </div>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fade-enter fixed inset-0 z-30 bg-stone-900/40 backdrop-blur-[2px] lg:hidden"
          onClick={close}
          aria-hidden
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 w-[264px] transform border-r border-stone-200 bg-white shadow-2xl transition-transform duration-200 ease-out lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarBody}
      </aside>
    </>
  );
}
