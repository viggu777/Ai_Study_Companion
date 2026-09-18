"use client";

import { useState } from "react";
import Sidebar, {
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_FULL,
  useSidebarCollapsed,
} from "./Sidebar";
import { TopBar } from "./TopBar";

/**
 * Global app shell — sidebar + top bar + content column for every
 * authenticated route. The right column is locked to the viewport height:
 * the top bar stays pinned while the main content area scrolls, so pages
 * (e.g. Tutor) fill 100% of the available height with no outer card.
 */
export default function AppShell({
  userEmail,
  userName,
  isAdmin,
  children,
}: {
  userEmail: string | null;
  userName: string;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const [collapsed] = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="h-dvh overflow-hidden bg-stone-100">
      <Sidebar
        userEmail={userEmail}
        userName={userName}
        isAdmin={isAdmin}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div
        data-sidebar-offset={collapsed ? "collapsed" : "full"}
        className="flex h-dvh flex-col transition-all duration-200 ease-out"
      >
        <TopBar userEmail={userEmail} userName={userName} isAdmin={isAdmin} onMenu={() => setMobileOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">{children}</main>
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
          @media (min-width: 1024px) {
            [data-sidebar-offset="full"] { padding-left: ${SIDEBAR_WIDTH_FULL}px; }
            [data-sidebar-offset="collapsed"] { padding-left: ${SIDEBAR_WIDTH_COLLAPSED}px; }
          }`,
        }}
      />
    </div>
  );
}
