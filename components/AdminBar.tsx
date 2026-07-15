"use client";

import { useAdminBar } from "./AdminProvider";
import { logoutAction } from "@/app/admin/login/actions";

/**
 * Slim bar pinned at the bottom of the shell, shown only when logged in.
 * Left: admin label + log out. Right: unsaved-edit count + Save all / Discard
 * all (only when there are staged edits). Replaces the old /admin dashboard.
 */
export default function AdminBar() {
  const { isAdmin, dirtyCount, saving, saveAll, discardAll } = useAdminBar();
  if (!isAdmin) return null;

  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-t border-hairline bg-panel px-4 py-2 text-[15px]">
      <div className="flex items-center gap-3">
        <span className="font-pixel text-[11px] text-ink">admin</span>
        <form action={logoutAction}>
          <button
            type="submit"
            className="text-ink-muted underline-offset-4 hover:text-steel hover:underline"
          >
            log out
          </button>
        </form>
      </div>

      {dirtyCount > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-ink-muted">
            {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
          </span>
          <button
            type="button"
            onClick={discardAll}
            disabled={saving}
            className="rounded-[2px] border border-hairline px-3 py-1 text-ink-muted hover:border-steel hover:text-steel disabled:opacity-50"
          >
            Discard all
          </button>
          <button
            type="button"
            onClick={saveAll}
            disabled={saving}
            className="rounded-[2px] bg-steel px-3 py-1 font-medium text-page hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save all"}
          </button>
        </div>
      )}
    </div>
  );
}
