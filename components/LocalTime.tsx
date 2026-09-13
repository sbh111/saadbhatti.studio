"use client";

import { useEffect, useState } from "react";

// Medium-date/short-time — the style previously used server-side (tech debt 3.6).
const style = { dateStyle: "medium", timeStyle: "short" } as const;

// Explicit UTC: used for the deterministic first paint so the server-rendered
// markup and the client's first render match exactly (React hydration requires
// this). The server has no idea where the admin actually is, and formatting
// with an implicit timezone would silently resolve to the *server's* (UTC),
// presented unlabelled as if it were local — exactly the bug this fixes.
const utcFmt = new Intl.DateTimeFormat("en-US", { ...style, timeZone: "UTC" });
// No explicit timeZone: once this runs in the browser, Intl resolves it to the
// *viewer's* local timezone.
const localFmt = new Intl.DateTimeFormat("en-US", style);

/**
 * Renders a timestamp in the viewer's own timezone. Server components (and
 * admin pages in particular) have no way to know the viewer's offset, so this
 * must happen client-side: the server/first-paint render is a deterministic
 * UTC string labelled "UTC" (never presented as if it were local), then a
 * `useEffect` — which only ever runs in the browser, after mount — swaps it
 * for the viewer's local formatting. No hydration mismatch, because the first
 * client render before the effect fires reproduces the server's markup exactly.
 */
export default function LocalTime({ date }: { date: Date | string }) {
  const iso = typeof date === "string" ? date : date.toISOString();
  const [text, setText] = useState(() => `${utcFmt.format(new Date(iso))} UTC`);

  useEffect(() => {
    // Deliberate: this is the hydration-safe pattern itself, not the
    // synchronization anti-pattern the rule warns about — the effect exists
    // solely to defer to a value (the viewer's local timezone) that only the
    // browser knows, one time after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(localFmt.format(new Date(iso)));
  }, [iso]);

  return <time dateTime={iso}>{text}</time>;
}
