/** Reusable placeholder for any not-yet-ready section. */
export default function WIPView() {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">
        Work in progress
      </h1>
      <p className="text-[17px] text-ink-muted">Stay tuned…</p>
    </div>
  );
}
