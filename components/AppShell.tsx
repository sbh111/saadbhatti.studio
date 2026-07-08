"use client";

import Link from "next/link";
import { useState } from "react";
import type { NavNode } from "@/lib/nav";
import NavTree from "./NavTree";

function Wordmark({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="block whitespace-nowrap font-pixel text-[15px] leading-relaxed text-ink"
    >
      Saad Bhatti
    </Link>
  );
}

function SidebarContent({
  tree,
  onNavigate,
}: {
  tree: NavNode[];
  onNavigate?: () => void;
}) {
  return (
    <div className="no-scrollbar flex h-full flex-col overflow-y-auto pb-5 pt-6">
      <div className="px-3.5 pb-3.5">
        <Wordmark onNavigate={onNavigate} />
      </div>
      <div className="mx-3.5 mb-3 border-t border-hairline" />
      <NavTree tree={tree} onNavigate={onNavigate} />
    </div>
  );
}

export default function AppShell({
  tree,
  children,
}: {
  tree: NavNode[];
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = () => setDrawerOpen(false);

  return (
    <div className="flex h-full flex-col desk:flex-row">
      {/* Mobile top bar */}
      <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-hairline bg-panel px-4 desk:hidden">
        <span className="whitespace-nowrap font-pixel text-[12px] text-ink">
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
      <aside className="hidden w-[236px] shrink-0 border-r border-hairline bg-panel desk:block">
        <SidebarContent tree={tree} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 desk:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 animate-fadein bg-black/35 motion-reduce:animate-none"
            onClick={closeDrawer}
          />
          <div className="absolute inset-y-0 left-0 w-[300px] max-w-[85vw] animate-drawer bg-panel shadow-xl motion-reduce:animate-none">
            <SidebarContent tree={tree} onNavigate={closeDrawer} />
          </div>
        </div>
      )}

      {/* Main content area — its own scroll region, smooth anchor scrolling */}
      <main className="min-w-0 grow scroll-smooth overflow-y-auto bg-page motion-reduce:scroll-auto">
        {children}
      </main>
    </div>
  );
}
