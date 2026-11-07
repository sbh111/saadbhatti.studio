"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary (tech debt 1.4 — there were none anywhere in the app
 * before this): catches an error thrown by the ROOT LAYOUT itself — e.g.
 * buildNavTree/getCatalog, before the try/catch guard in app/layout.tsx
 * existed, or any future error there error.tsx can't reach because error.tsx
 * is rendered INSIDE the root layout. Next requires this file to render its
 * own <html>/<body>, because the real root layout is exactly what's being
 * replaced — so this is deliberately minimal and dependency-free (inline
 * styles, no fonts, no shared components, nothing that assumes globals.css or
 * any provider loaded), since it has to keep working when almost everything
 * else just failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[root layout error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          margin: 0,
          padding: "0 20px",
          textAlign: "center",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background: "#e9ebee",
          color: "#262a2e",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
          something went wrong
        </h1>
        <p style={{ maxWidth: 420, color: "#6c727a", margin: 0 }}>
          The site hit an unexpected error loading this page. Try again in a
          moment.
        </p>
        <button
          onClick={reset}
          style={{
            borderRadius: 2,
            background: "#445059",
            color: "#e9ebee",
            padding: "0.5rem 1rem",
            fontSize: "15px",
            fontWeight: 500,
            border: "none",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
