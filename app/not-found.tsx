import Link from "next/link";

/**
 * App-wide 404 (tech debt 1.4 — there was none before this; a redirect to a
 * href-less route, e.g. the old `/admin/login` → `/admin` bug, used to fall
 * through to Next's bare default 404 with no styling and no way back).
 * Renders inside the root layout, so it gets the real nav/shell around it.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="font-pixel text-lg leading-relaxed text-ink">
        not found
      </h1>
      <p className="max-w-[420px] text-[15px] text-ink-muted">
        There&rsquo;s nothing at this address.
      </p>
      <Link
        href="/"
        className="rounded-[2px] bg-steel px-4 py-2 text-[15px] font-medium text-page hover:opacity-90"
      >
        Back home
      </Link>
    </div>
  );
}
