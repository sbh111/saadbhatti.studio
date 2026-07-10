"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Client-side admin state for inline editing on CollectionView.
 *
 * Edits are staged in localStorage (survive refresh / navigating between
 * collections) until the admin bulk-saves them to Cloudinary or discards them.
 * Two contexts on purpose: captions consume the *stable* EditContext (they hold
 * their own input state locally for speed), while only the AdminBar consumes
 * BarContext, which changes on every keystroke via dirtyCount.
 */

export const FIELD_KEYS = [
  "title",
  "Film",
  "Medium",
  "Dimensions",
  "Year",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
export type Fields = Record<FieldKey, string>;

const LS_KEY = "sbh_admin_edits";

interface EditContextValue {
  isAdmin: boolean;
  /** Re-seed signal — bumps after localStorage hydration and after Discard. */
  syncSignal: number;
  /** Staged fields for an artwork, if any (used to seed a caption's inputs). */
  getStaged: (publicId: string) => Fields | undefined;
  /** Report an artwork's edited fields, or null when it matches the original. */
  report: (publicId: string, fields: Fields | null) => void;
}

interface BarContextValue {
  isAdmin: boolean;
  dirtyCount: number;
  saving: boolean;
  saveAll: () => Promise<void>;
  discardAll: () => void;
}

const EditContext = createContext<EditContextValue | null>(null);
const BarContext = createContext<BarContextValue | null>(null);

export function useArtworkEdit() {
  const ctx = useContext(EditContext);
  if (!ctx) throw new Error("useArtworkEdit must be used within AdminProvider");
  return ctx;
}

export function useAdminBar() {
  const ctx = useContext(BarContext);
  if (!ctx) throw new Error("useAdminBar must be used within AdminProvider");
  return ctx;
}

function loadEdits(): Record<string, Fields> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export default function AdminProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Admin status: the session cookie is HttpOnly, so it's resolved with one
  // small fetch. Re-checked on route change because login/logout redirect via
  // client navigation (the provider never remounts).
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/session", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { isAdmin: false }))
      .then((data) => !cancelled && setIsAdmin(data.isAdmin === true))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Staged edits: a mutable ref (avoids re-rendering captions on keystroke) plus
  // a dirtyCount state that drives only the AdminBar.
  const editsRef = useRef<Record<string, Fields>>({});
  const [dirtyCount, setDirtyCount] = useState(0);
  const [syncSignal, setSyncSignal] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    editsRef.current = loadEdits();
    setDirtyCount(Object.keys(editsRef.current).length);
    setSyncSignal((s) => s + 1); // let mounted captions re-seed from storage
  }, []);

  const persist = useCallback(() => {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(editsRef.current));
    } catch {
      /* storage full / unavailable — edits simply won't survive a refresh */
    }
  }, []);

  const report = useCallback(
    (publicId: string, fields: Fields | null) => {
      if (fields) editsRef.current[publicId] = fields;
      else delete editsRef.current[publicId];
      persist();
      setDirtyCount(Object.keys(editsRef.current).length);
    },
    [persist]
  );

  const getStaged = useCallback(
    (publicId: string) => editsRef.current[publicId],
    []
  );

  const discardAll = useCallback(() => {
    editsRef.current = {};
    persist();
    setDirtyCount(0);
    setSyncSignal((s) => s + 1); // captions reset their inputs to the originals
  }, [persist]);

  const saveAll = useCallback(async () => {
    const entries = Object.entries(editsRef.current);
    if (entries.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/artworks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          entries.map(([publicId, fields]) => ({ publicId, fields }))
        ),
      });
      if (!res.ok) throw new Error(`save failed: HTTP ${res.status}`);
      const { failed } = (await res.json()) as { failed: string[] };
      // Keep any that failed staged so the count reflects reality.
      const remaining: Record<string, Fields> = {};
      for (const id of failed ?? []) {
        if (editsRef.current[id]) remaining[id] = editsRef.current[id];
      }
      editsRef.current = remaining;
      persist();
      setDirtyCount(Object.keys(remaining).length);
      setSyncSignal((s) => s + 1);
      router.refresh(); // pull the freshly-saved values back from Cloudinary
      if (failed?.length) {
        alert(`${failed.length} artwork(s) failed to save and are still staged.`);
      }
    } catch (err) {
      console.error(err);
      alert("Save failed. Your edits are still staged — try again.");
    } finally {
      setSaving(false);
    }
  }, [persist, router]);

  const editValue = useMemo<EditContextValue>(
    () => ({ isAdmin, syncSignal, getStaged, report }),
    [isAdmin, syncSignal, getStaged, report]
  );
  const barValue = useMemo<BarContextValue>(
    () => ({ isAdmin, dirtyCount, saving, saveAll, discardAll }),
    [isAdmin, dirtyCount, saving, saveAll, discardAll]
  );

  return (
    <EditContext.Provider value={editValue}>
      <BarContext.Provider value={barValue}>{children}</BarContext.Provider>
    </EditContext.Provider>
  );
}
