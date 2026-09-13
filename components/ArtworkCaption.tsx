"use client";

import { useEffect, useState } from "react";
import {
  fieldsFromContext,
  FIELD_KEYS,
  METADATA_FIELDS,
  type FieldKey,
  type Fields,
} from "@/lib/artworkFields";
import { useArtworkEdit } from "./AdminProvider";

/**
 * The name + metadata under an artwork on CollectionView. Logged out (or when
 * admin status is still resolving) it renders exactly as before — plain text.
 * When logged in as admin, it becomes inline inputs whose changes are staged in
 * the shared edit store for a later bulk save.
 */
export default function ArtworkCaption({
  publicId,
  name,
  metaLine,
  contextTitle,
  metaFields,
}: {
  publicId: string;
  name: string;
  metaLine: string;
  contextTitle: string;
  metaFields: Record<string, string>;
}) {
  const { isAdmin, syncSignal, getStaged, report } = useArtworkEdit();

  // Derived from lib/artworkFields.ts's METADATA_FIELDS — adding a field
  // there means this can't silently miss it (tech debt 3.1).
  const original: Fields = fieldsFromContext(contextTitle, metaFields);

  const [vals, setVals] = useState<Fields>(original);

  // Re-seed from the staged store on hydration and after Discard (syncSignal).
  // Deliberately omits `getStaged`, `publicId`, and `original` — `original` is
  // rebuilt from props on every render, so listing it would reseed on every
  // render instead of only on the intended syncSignal trigger. The real hazard:
  // AdminProvider's `saveAll` bumps `syncSignal` and calls `router.refresh()`
  // in the same tick, but the refresh is async — this effect fires immediately
  // and closes over the PRE-refresh `original` (the old contextTitle/
  // metaFields), and nothing re-triggers it once the refreshed props actually
  // arrive. A save that changes this artwork's own fields can therefore appear
  // not to have taken effect until some later, unrelated syncSignal bump
  // (another save, or Discard). See docs/tech-debt.md 4.1.
  useEffect(() => {
    setVals(getStaged(publicId) ?? original);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncSignal]);

  if (!isAdmin) {
    return (
      <>
        <div className="text-lg font-medium text-ink">{name}</div>
        {metaLine && (
          <div className="mt-0.5 text-[15px] text-ink-muted">{metaLine}</div>
        )}
      </>
    );
  }

  function update(key: FieldKey, value: string) {
    const next = { ...vals, [key]: value };
    setVals(next);
    const dirty = FIELD_KEYS.some((k) => next[k] !== original[k]);
    report(publicId, dirty ? next : null);
  }

  const dirty = FIELD_KEYS.some((k) => vals[k] !== original[k]);
  const inputClasses =
    "w-full rounded-[2px] border bg-page px-2 py-1 text-[15px] text-ink outline-none focus:border-steel";

  return (
    <div className={`rounded-[2px] p-2 ${dirty ? "bg-nav-active/60" : ""}`}>
      <input
        aria-label="Title"
        value={vals.title}
        placeholder={contextTitle ? undefined : name}
        onChange={(e) => update("title", e.target.value)}
        className={`${inputClasses} text-lg font-medium ${
          vals.title !== original.title ? "border-steel" : "border-hairline"
        }`}
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        {METADATA_FIELDS.map(({ label }) => (
          <label key={label} className="block text-sm text-ink-muted">
            {label}
            <input
              value={vals[label as FieldKey]}
              onChange={(e) => update(label as FieldKey, e.target.value)}
              className={`mt-0.5 ${inputClasses} ${
                vals[label as FieldKey] !== original[label as FieldKey]
                  ? "border-steel"
                  : "border-hairline"
              }`}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
