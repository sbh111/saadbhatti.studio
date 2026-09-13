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
import type { Fields } from "@/lib/artworkFields";
import { applyStagingChange, parseStagingMap } from "@/lib/adminStaging";

/**
 * Client-side admin state for CollectionView: inline metadata editing (1a) and
 * drag-to-reorder (1b).
 *
 * Both are staged in localStorage (survive refresh / navigating between
 * collections) until the admin bulk-saves to Cloudinary or discards. Three
 * contexts on purpose, each with its own churn profile:
 *  - EditContext: stable identity, consumed by every caption (they hold their
 *    own input state locally for speed).
 *  - OrderContext: bumps only on drop, consumed by the reorder panel + the
 *    reorderable list.
 *  - BarContext: bumps on every keystroke / drop via dirtyCount, consumed only
 *    by the AdminBar.
 *  - AdminStatusContext: bare logged-in flag whose identity changes ONLY on
 *    login/logout — consumed by things that just need "am I admin?" (the nav
 *    splice, the inquiry form's admin-hide) without the churn of the three
 *    above (Bar bumps per keystroke, Edit/Order bump on sync/drop).
 */

// The field list itself lives in lib/artworkFields.ts (client-safe, no
// server import) so this module, ArtworkCaption, and the admin route all
// derive from ONE place — adding a field there is now a one-line change
// (tech debt 3.1). Re-exported here so existing imports of FIELD_KEYS/
// FieldKey/Fields from this module don't need to change.
export { FIELD_KEYS } from "@/lib/artworkFields";
export type { FieldKey, Fields } from "@/lib/artworkFields";

const LS_KEY = "sbh_admin_edits";
const LS_ORDER_KEY = "sbh_admin_order";

interface EditContextValue {
  isAdmin: boolean;
  /** Re-seed signal — bumps after localStorage hydration and after Discard. */
  syncSignal: number;
  /** Staged fields for an artwork, if any (used to seed a caption's inputs). */
  getStaged: (publicId: string) => Fields | undefined;
  /** Report an artwork's edited fields, or null when it matches the original. */
  report: (publicId: string, fields: Fields | null) => void;
}

interface OrderContextValue {
  isAdmin: boolean;
  /** Bumps after hydration, every drop, and after Discard — re-read trigger. */
  orderVersion: number;
  /** Staged order (public ids) for a collection path, if any. */
  getStagedOrder: (collectionPath: string) => string[] | undefined;
  /** Stage a collection's order, or null when it matches the saved order. */
  stageOrder: (collectionPath: string, orderedPublicIds: string[] | null) => void;
}

interface BarContextValue {
  isAdmin: boolean;
  dirtyCount: number;
  saving: boolean;
  saveAll: () => Promise<void>;
  discardAll: () => void;
}

interface AdminStatusContextValue {
  isAdmin: boolean;
}

const EditContext = createContext<EditContextValue | null>(null);
const OrderContext = createContext<OrderContextValue | null>(null);
const BarContext = createContext<BarContextValue | null>(null);
const AdminStatusContext = createContext<AdminStatusContextValue | null>(null);

export function useArtworkEdit() {
  const ctx = useContext(EditContext);
  if (!ctx) throw new Error("useArtworkEdit must be used within AdminProvider");
  return ctx;
}

export function useArtworkOrder() {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error("useArtworkOrder must be used within AdminProvider");
  return ctx;
}

export function useAdminBar() {
  const ctx = useContext(BarContext);
  if (!ctx) throw new Error("useAdminBar must be used within AdminProvider");
  return ctx;
}

/** Just the logged-in flag — stable across edit/order/bar churn. */
export function useIsAdmin(): boolean {
  const ctx = useContext(AdminStatusContext);
  if (!ctx) throw new Error("useIsAdmin must be used within AdminProvider");
  return ctx.isAdmin;
}

function loadEdits(): Record<string, Fields> {
  if (typeof window === "undefined") return {};
  return parseStagingMap<Fields>(window.localStorage.getItem(LS_KEY));
}

function loadOrders(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  return parseStagingMap<string[]>(window.localStorage.getItem(LS_ORDER_KEY));
}

/** Unconditional write — used for a full-map replace (Discard, or a save's
 * post-response prune), never for a single staged change. See `report` and
 * `stageOrder` below for the read-merge-write path a single change goes
 * through instead. */
function writeEdits(map: Record<string, Fields>) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    /* storage full / unavailable — edits simply won't survive a refresh */
  }
}

function writeOrders(map: Record<string, string[]>) {
  try {
    window.localStorage.setItem(LS_ORDER_KEY, JSON.stringify(map));
  } catch {
    /* storage full / unavailable — order simply won't survive a refresh */
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

  // Staged edits + staged orders: mutable refs (avoid re-rendering captions /
  // the list on every change) plus counters that drive the consuming UIs.
  const editsRef = useRef<Record<string, Fields>>({});
  const orderRef = useRef<Record<string, string[]>>({});
  const [dirtyCount, setDirtyCount] = useState(0);
  const [syncSignal, setSyncSignal] = useState(0);
  const [orderVersion, setOrderVersion] = useState(0);
  const [saving, setSaving] = useState(false);

  const recomputeDirty = useCallback(() => {
    setDirtyCount(
      Object.keys(editsRef.current).length + Object.keys(orderRef.current).length
    );
  }, []);

  useEffect(() => {
    editsRef.current = loadEdits();
    orderRef.current = loadOrders();
    recomputeDirty();
    setSyncSignal((s) => s + 1); // let mounted captions re-seed from storage
    setOrderVersion((v) => v + 1); // let mounted list/panel re-seed from storage
  }, [recomputeDirty]);

  // Cross-tab sync (tech debt 1.6): the `storage` event fires in every OTHER
  // tab sharing this origin when one of them writes localStorage — never in
  // the tab that made the write. Re-hydrating from `e.newValue` here (rather
  // than re-reading via loadEdits/loadOrders) avoids a second synchronous
  // localStorage read and matches exactly what the writing tab persisted.
  // Without this, a second open tab held its mount-time snapshot forever and
  // its own next write (a whole-map replace, pre-1.6) would erase whatever
  // the first tab had staged since.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === LS_KEY) {
        editsRef.current = parseStagingMap<Fields>(e.newValue);
        recomputeDirty();
        setSyncSignal((s) => s + 1); // re-seed mounted captions from the merged map
      } else if (e.key === LS_ORDER_KEY) {
        orderRef.current = parseStagingMap<string[]>(e.newValue);
        recomputeDirty();
        setOrderVersion((v) => v + 1); // re-seed the reorder panel/list
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [recomputeDirty]);

  const report = useCallback(
    (publicId: string, fields: Fields | null) => {
      // Read-merge-write (tech debt 1.6): re-read the map fresh rather than
      // trust editsRef, apply ONLY this key's change, then write the result
      // back and adopt it as the new in-memory snapshot. This is what makes
      // two tabs staging different artworks land BOTH edits instead of the
      // second tab's whole-map write erasing the first tab's entry.
      const merged = applyStagingChange(loadEdits(), publicId, fields);
      editsRef.current = merged;
      writeEdits(merged);
      recomputeDirty();
    },
    [recomputeDirty]
  );

  const getStaged = useCallback(
    (publicId: string) => editsRef.current[publicId],
    []
  );

  const stageOrder = useCallback(
    (collectionPath: string, orderedPublicIds: string[] | null) => {
      // Same read-merge-write as `report` above, for the order map.
      const merged = applyStagingChange(
        loadOrders(),
        collectionPath,
        orderedPublicIds
      );
      orderRef.current = merged;
      writeOrders(merged);
      recomputeDirty();
      setOrderVersion((v) => v + 1);
    },
    [recomputeDirty]
  );

  const getStagedOrder = useCallback(
    (collectionPath: string) => orderRef.current[collectionPath],
    []
  );

  const discardAll = useCallback(() => {
    // Unlike report/stageOrder, this is a deliberate full wipe, not a
    // single-key change — a plain write of `{}` (rather than a merge) is the
    // correct behavior, and it propagates to any other open tab via the
    // `storage` listener above, clearing their view too.
    editsRef.current = {};
    orderRef.current = {};
    writeEdits({});
    writeOrders({});
    setDirtyCount(0);
    setSyncSignal((s) => s + 1); // captions reset their inputs to the originals
    setOrderVersion((v) => v + 1); // list/panel reset to the saved order
  }, []);

  const saveAll = useCallback(async () => {
    const editEntries = Object.entries(editsRef.current);
    const reorderEntries = Object.entries(orderRef.current);
    if (editEntries.length === 0 && reorderEntries.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/artworks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          edits: editEntries.map(([publicId, fields]) => ({
            publicId,
            fields,
          })),
          reorders: reorderEntries.map(([collectionPath, orderedPublicIds]) => ({
            collectionPath,
            orderedPublicIds,
          })),
        }),
      });
      if (!res.ok) throw new Error(`save failed: HTTP ${res.status}`);
      const { failedEdits, failedReorders } = (await res.json()) as {
        savedEdits: number;
        failedEdits: string[];
        savedReorders: number;
        failedReorders: { path: string; reason: "stale" | "error" }[];
      };

      // Keep failed edits staged so the count reflects reality.
      //
      // NOTE: this still replaces the whole map from a pre-request snapshot
      // rather than read-merge-writing (tech debt 1.5 — saveAll can wipe an
      // edit staged, in THIS or another tab, while the request was in
      // flight). 1.6 only fixes the single-key paths (report/stageOrder); the
      // snapshot-vs-in-flight-edit race here is 1.5's fix.
      const remaining: Record<string, Fields> = {};
      for (const id of failedEdits ?? []) {
        if (editsRef.current[id]) remaining[id] = editsRef.current[id];
      }
      editsRef.current = remaining;
      writeEdits(remaining);

      // Reorders are NOT cleared here: successful ones self-clear via the
      // reorderable list's cleanup effect once router.refresh() delivers the new
      // server order (avoids an order flash); failed ones must stay staged for
      // retry. Nothing to prune from orderRef.
      recomputeDirty();
      setSyncSignal((s) => s + 1);
      setOrderVersion((v) => v + 1);
      router.refresh(); // pull freshly-saved values + new order from Cloudinary

      const failedTotal =
        (failedEdits?.length ?? 0) + (failedReorders?.length ?? 0);
      if (failedTotal > 0) {
        const stale = (failedReorders ?? []).some((r) => r.reason === "stale");
        alert(
          `${failedTotal} change(s) failed to save and are still staged.` +
            (stale
              ? " A reorder was stale (the collection changed in Cloudinary) — discard and re-drag it."
              : "")
        );
      }
    } catch (err) {
      console.error(err);
      alert("Save failed. Your changes are still staged — try again.");
    } finally {
      setSaving(false);
    }
  }, [recomputeDirty, router]);

  const editValue = useMemo<EditContextValue>(
    () => ({ isAdmin, syncSignal, getStaged, report }),
    [isAdmin, syncSignal, getStaged, report]
  );
  const orderValue = useMemo<OrderContextValue>(
    () => ({ isAdmin, orderVersion, getStagedOrder, stageOrder }),
    [isAdmin, orderVersion, getStagedOrder, stageOrder]
  );
  const barValue = useMemo<BarContextValue>(
    () => ({ isAdmin, dirtyCount, saving, saveAll, discardAll }),
    [isAdmin, dirtyCount, saving, saveAll, discardAll]
  );
  // Identity changes only when isAdmin flips (login/logout) — see the context
  // note above.
  const statusValue = useMemo<AdminStatusContextValue>(
    () => ({ isAdmin }),
    [isAdmin]
  );

  return (
    <AdminStatusContext.Provider value={statusValue}>
      <EditContext.Provider value={editValue}>
        <OrderContext.Provider value={orderValue}>
          <BarContext.Provider value={barValue}>{children}</BarContext.Provider>
        </OrderContext.Provider>
      </EditContext.Provider>
    </AdminStatusContext.Provider>
  );
}
