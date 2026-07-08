/** Reusable placeholder for any not-yet-ready section. */
export default function WIPView() {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="font-pixel text-xl leading-relaxed text-ink">
        Work in progress
      </h1>
      <p className="text-lg text-ink-muted">Stay tuned…</p>
    </div>
  );
}
