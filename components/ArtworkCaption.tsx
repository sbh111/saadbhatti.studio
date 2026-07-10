"use client";

import { useEffect, useState } from "react";
import {
  FIELD_KEYS,
  useArtworkEdit,
  type Fields,
  type FieldKey,
} from "./AdminProvider";

// The metadata fields (everything except the title) — same labels the catalog
// reads from Cloudinary context, kept here so this client file needn't import
// the server-only catalog module.
const META_LABELS = FIELD_KEYS.filter((k) => k !== "title") as FieldKey[];

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

  const original: Fields = {
    title: contextTitle,
    Film: metaFields.Film ?? "",
    Medium: metaFields.Medium ?? "",
    Dimensions: metaFields.Dimensions ?? "",
    Year: metaFields.Year ?? "",
  };

  const [vals, setVals] = useState<Fields>(original);

  // Re-seed from the staged store on hydration and after Discard (syncSignal).
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
        {META_LABELS.map((key) => (
          <label key={key} className="block text-sm text-ink-muted">
            {key}
            <input
              value={vals[key]}
              onChange={(e) => update(key, e.target.value)}
              className={`mt-0.5 ${inputClasses} ${
                vals[key] !== original[key] ? "border-steel" : "border-hairline"
              }`}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
