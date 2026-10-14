"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary (tech debt 1.4 — there were none anywhere in the
 * app before this). Catches a render/data error thrown anywhere under a route
 * segment WITHOUT taking the rest of the app down with it: the root layout,
 * nav, and every other route keep working normally. See global-error.tsx for
 * the one case this can't catch — an error thrown by the root layout itself.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="font-pixel text-lg leading-relaxed text-ink">
        something went wrong
      </h1>
      <p className="max-w-[420px] text-[15px] text-ink-muted">
        This page hit an unexpected error. It&rsquo;s likely temporary —
        try again.
      </p>
      <button
        onClick={reset}
        className="rounded-[2px] bg-steel px-4 py-2 text-[15px] font-medium text-page hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
