"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getSessionId } from "@/lib/sessionId";
import {
  EVENT_SCHEMA_VERSION,
  FLUSH_INTERVAL_MS,
  MAX_BATCH,
  type ClientEvent,
  type EventType,
  type IntentGesture,
} from "@/lib/eventTypes";
import { useIsAdmin } from "./AdminProvider";

/**
 * Clickstream capture for the (optional, toggleable) Kafka pipeline. Mounted
 * once in AppShell; renders nothing. Everything here is wrapped so it can NEVER
 * throw into render or break navigation — analytics must be invisible when it
 * fails.
 *
 * Active only when: the server toggle is on (fetched once via /api/events/config),
 * the visitor isn't an admin (useIsAdmin — don't track ourselves), and Do Not
 * Track / Global Privacy Control isn't set. Events queue and flush on a timer
 * and on page hide via sendBeacon (survives unload). Artwork elements are found
 * by the `data-artwork-id` attribute ArtworkBlock stamps on each <figure>.
 */

function dntEnabled(): boolean {
  try {
    const nav = navigator as Navigator & {
      msDoNotTrack?: string;
      globalPrivacyControl?: boolean;
    };
    return (
      nav.doNotTrack === "1" ||
      nav.msDoNotTrack === "1" ||
      (window as unknown as { doNotTrack?: string }).doNotTrack === "1" ||
      nav.globalPrivacyControl === true
    );
  } catch {
    return false;
  }
}

function linkLabel(a: HTMLAnchorElement): string {
  const explicit = a.dataset.track;
  if (explicit) return explicit;
  const text = a.textContent?.trim();
  if (text) return text.slice(0, 64);
  try {
    return new URL(a.href).pathname;
  } catch {
    return "link";
  }
}

export default function EventTracker() {
  const isAdmin = useIsAdmin();
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);

  const queueRef = useRef<ClientEvent[]>([]);
  const viewedRef = useRef<Set<string>>(new Set()); // artwork_view: once per session
  const sessionIdRef = useRef<string>("");

  const active = enabled && !isAdmin;

  // Resolve the toggle once. DNT short-circuits before we ever ask the server.
  useEffect(() => {
    if (dntEnabled()) return;
    sessionIdRef.current = getSessionId();
    let cancelled = false;
    fetch("/api/events/config", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { enabled: false }))
      .then((data) => !cancelled && setEnabled(data.enabled === true))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const flush = useCallback((viaBeacon: boolean) => {
    const q = queueRef.current;
    if (q.length === 0) return;
    queueRef.current = [];
    try {
      const body = JSON.stringify({ events: q });
      if (viaBeacon && navigator.sendBeacon) {
        // MUST be a Blob with an explicit type, or the browser sends text/plain
        // and the route rejects the body.
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon("/api/events", blob)) return;
      }
      fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* never let telemetry break the page */
    }
  }, []);

  const enqueue = useCallback(
    (type: EventType, extra?: Partial<ClientEvent>) => {
      if (!sessionIdRef.current) return;
      try {
        queueRef.current.push({
          v: EVENT_SCHEMA_VERSION,
          type,
          ts: new Date().toISOString(),
          sessionId: sessionIdRef.current,
          path: window.location.pathname,
          referrer: document.referrer || null,
          ...extra,
        });
        if (queueRef.current.length >= MAX_BATCH) flush(false);
      } catch {
        /* ignore */
      }
    },
    [flush]
  );

  // page_view: on activation and on every client-side route change.
  useEffect(() => {
    if (!active) return;
    enqueue("page_view");
  }, [active, pathname, enqueue]);

  // Listeners + IntersectionObserver. Re-run on navigation so the observer picks
  // up the newly mounted artwork elements.
  useEffect(() => {
    if (!active) return;

    const emitIntent = (el: Element | null, gesture: IntentGesture) => {
      const id = (el as HTMLElement | null)?.dataset?.artworkId;
      if (id) enqueue("artwork_intent", { artworkPublicId: id, gesture });
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      const artwork = target.closest<HTMLElement>("[data-artwork-id]");
      if (artwork && (e.metaKey || e.ctrlKey)) {
        emitIntent(artwork, "modifier_click");
        return;
      }
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (anchor) enqueue("click", { target: linkLabel(anchor) });
    };
    const onAux = (e: MouseEvent) => {
      if (e.button !== 1) return; // middle-click only
      const artwork = (e.target as Element | null)?.closest("[data-artwork-id]");
      if (artwork) emitIntent(artwork, "middle_click");
    };
    const onContext = (e: MouseEvent) => {
      const artwork = (e.target as Element | null)?.closest("[data-artwork-id]");
      if (artwork) emitIntent(artwork, "context_menu");
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onAux, true);
    document.addEventListener("contextmenu", onContext, true);

    // artwork_view: ≥50% of the IMAGE visible for ≥1s, once per artwork per
    // session. We observe the image box, not the whole <figure> — the figure
    // (caption + like + inquiry) is taller than the viewport, so its ratio would
    // never reach 0.5. The id lives on the figure, so map each box back to it.
    const idByEl = new Map<Element, string>();
    const dwell = new Map<Element, ReturnType<typeof setTimeout>>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target;
          const id = idByEl.get(el);
          if (!id || viewedRef.current.has(id)) {
            observer.unobserve(el);
            continue;
          }
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            if (!dwell.has(el)) {
              dwell.set(
                el,
                setTimeout(() => {
                  viewedRef.current.add(id);
                  enqueue("artwork_view", { artworkPublicId: id });
                  observer.unobserve(el);
                  dwell.delete(el);
                }, 1000)
              );
            }
          } else {
            const t = dwell.get(el);
            if (t) {
              clearTimeout(t);
              dwell.delete(el);
            }
          }
        }
      },
      { threshold: [0, 0.5, 1] }
    );
    document.querySelectorAll<HTMLElement>("[data-artwork-id]").forEach((fig) => {
      const box = (fig.firstElementChild as HTMLElement | null) ?? fig; // ArtworkImage box
      const id = fig.dataset.artworkId;
      if (!id) return;
      idByEl.set(box, id);
      observer.observe(box);
    });

    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onAux, true);
      document.removeEventListener("contextmenu", onContext, true);
      dwell.forEach((t) => clearTimeout(t));
      observer.disconnect();
    };
  }, [active, pathname, enqueue]);

  // Periodic flush + flush-on-hide (sendBeacon survives unload).
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => flush(false), FLUSH_INTERVAL_MS);
    const onHide = () => flush(true);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      flush(true); // don't strand a partial batch on teardown
    };
  }, [active, flush]);

  return null;
}
