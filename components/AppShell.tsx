"use client";

import Link from "next/link";
import { useState } from "react";
import NavTree from "./NavTree";

function Wordmark({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="block whitespace-nowrap text-[22px] font-bold tracking-tight text-ink"
    >
      Saad Bhatti
    </Link>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto pb-5 pt-6">
      <div className="px-3.5 pb-3.5">
        <Wordmark onNavigate={onNavigate} />
      </div>
      <div className="mx-3.5 mb-3 border-t border-hairline" />
      <NavTree onNavigate={onNavigate} />
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = () => setDrawerOpen(false);

  return (
    <div className="flex h-full flex-col desk:flex-row">
      {/* Mobile top bar */}
      <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-hairline bg-panel px-4 desk:hidden">
        <span className="whitespace-nowrap text-[17px] font-bold tracking-tight text-ink">
          <Link href="/">Saad Bhatti</Link>
        </span>
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          className="-m-2 flex flex-col gap-1 p-2"
          onClick={() => setDrawerOpen(true)}
        >
          <span className="h-0.5 w-5 bg-ink" />
          <span className="h-0.5 w-5 bg-ink" />
          <span className="h-0.5 w-5 bg-ink" />
        </button>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden w-[220px] shrink-0 border-r border-hairline bg-panel desk:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 desk:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/35"
            onClick={closeDrawer}
          />
          <div className="absolute inset-y-0 left-0 w-[300px] max-w-[85vw] bg-panel shadow-xl transition-transform motion-reduce:transition-none">
            <SidebarContent onNavigate={closeDrawer} />
          </div>
        </div>
      )}

      {/* Main content area — its own scroll region */}
      <main className="min-w-0 grow overflow-y-auto bg-page">{children}</main>
    </div>
  );
}
