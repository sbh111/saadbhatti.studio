import { CLOUD_NAME } from "./cloudinary";

/**
 * Low-level authenticated Cloudinary Admin API client — everything that can
 * read or MUTATE Cloudinary lives here. lib/catalog.ts builds the read-side
 * domain model on top of apiGet(); admin route handlers use the write helpers.
 */

const BASE = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}`;

function authHeader(): string {
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!key || !secret) {
    throw new Error(
      "Missing CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET. Locally: put them in .env.local (see .env.local.example). On Vercel: Project → Settings → Environment Variables."
    );
  }
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

/** Cached read used by the public catalog; invalidated via revalidateTag("catalog"). */
export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: authHeader() },
    next: { revalidate: 3600, tags: ["catalog"] },
  });
  if (!response.ok) {
    throw new Error(
      `Cloudinary Admin API ${path} failed: HTTP ${response.status} ${await response.text()}`
    );
  }
  return response.json() as Promise<T>;
}

/** Uncached read — used before a write so the merge starts from fresh state. */
async function apiGetFresh<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: authHeader() },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `Cloudinary Admin API ${path} failed: HTTP ${response.status} ${await response.text()}`
    );
  }
  return response.json() as Promise<T>;
}

/** Cloudinary context strings are pipe-delimited key=value pairs. */
function escapeContext(value: string): string {
  return value.replace(/([=|])/g, "\\$1");
}

/**
 * Update an asset's contextual metadata. Cloudinary's update endpoint REPLACES
 * the entire custom context (verified empirically), so this reads the current
 * context first and merges: form keys overlay existing keys; a key set to ""
 * is dropped (deleted); unrelated keys (e.g. alt/Description) are preserved.
 */
export async function updateArtworkContext(
  publicId: string,
  fields: Record<string, string>
): Promise<void> {
  const current = await apiGetFresh<{
    context?: { custom?: Record<string, string> };
  }>(`/resources/image/upload/${encodeURIComponent(publicId)}`);

  const merged: Record<string, string> = {
    ...(current.context?.custom ?? {}),
  };
  for (const [key, value] of Object.entries(fields)) {
    const trimmed = value.trim();
    if (trimmed) merged[key] = trimmed;
    else delete merged[key];
  }

  const contextParam = Object.entries(merged)
    .map(([k, v]) => `${escapeContext(k)}=${escapeContext(v)}`)
    .join("|");

  const response = await fetch(
    `${BASE}/resources/image/upload/${encodeURIComponent(publicId)}`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ context: contextParam }),
      cache: "no-store",
    }
  );
  if (!response.ok) {
    throw new Error(
      `Cloudinary context update for "${publicId}" failed: HTTP ${response.status} ${await response.text()}`
    );
  }
}

/**
 * Rename an asset's display_name (its filename) WITHOUT touching public_id.
 * Deliberately the Admin API update endpoint — not the Upload-API `rename` —
 * so public_id (the stable key for staged edits, delivery URLs, future 1c DB
 * rows) never changes. De-risked empirically: this call preserves public_id,
 * asset_folder, and context.custom (an update that omits `context` leaves the
 * existing context intact — no REPLACE wipe).
 */
async function updateDisplayName(
  publicId: string,
  displayName: string
): Promise<void> {
  const response = await fetch(
    `${BASE}/resources/image/upload/${encodeURIComponent(publicId)}`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ display_name: displayName }),
      cache: "no-store",
    }
  );
  if (!response.ok) {
    throw new Error(
      `Cloudinary display_name update for "${publicId}" failed: HTTP ${response.status} ${await response.text()}`
    );
  }
}

type ReorderResult =
  | { ok: true }
  | { ok: false; reason: "stale" | "error"; message?: string };

/**
 * Reorder a collection by renumbering the `NN-` filename prefixes so that the
 * catalog's localeCompare(display_name) sort yields `orderedPublicIds`.
 *
 * Order = alphabetical display_name, so position N gets a zero-padded prefix
 * (uniform width within the collection: max(2, digits(count))). The original
 * suffix is preserved by stripping any existing leading digits with the same
 * regex prettifyFilename uses. Applied SEQUENTIALLY (rate-limit-friendly,
 * deterministic partial state) and no-ops are skipped, so a partial failure
 * leaves the reorder staged and re-saving recomputes + heals — idempotent.
 */
export async function reorderCollection(
  collectionPath: string,
  orderedPublicIds: string[]
): Promise<ReorderResult> {
  try {
    // Fresh (uncached) read of the live folder membership + current filenames.
    const data = await apiGetFresh<{
      resources?: { public_id: string; display_name?: string }[];
    }>(
      `/resources/by_asset_folder?asset_folder=${encodeURIComponent(
        collectionPath
      )}&max_results=500`
    );
    const resources = data.resources ?? [];

    // Stale check: if the live public_id set differs from what was staged (an
    // asset was added/removed since staging), refuse — bulk renames are
    // destructive, so reject rather than merge-guess. Stays staged client-side.
    const liveIds = new Set(resources.map((r) => r.public_id));
    const stagedIds = new Set(orderedPublicIds);
    const sameSize = liveIds.size === stagedIds.size;
    const sameMembers = [...stagedIds].every((id) => liveIds.has(id));
    if (!sameSize || !sameMembers) {
      return { ok: false, reason: "stale" };
    }

    const currentName = new Map(
      resources.map((r) => [
        r.public_id,
        r.display_name ?? r.public_id.split("/").pop() ?? r.public_id,
      ])
    );
    const width = Math.max(2, String(orderedPublicIds.length).length);

    // Sequential apply; skip no-ops (already-correct names) so retries are cheap.
    for (let i = 0; i < orderedPublicIds.length; i++) {
      const publicId = orderedPublicIds[i];
      const prefix = String(i + 1).padStart(width, "0");
      const suffix = (currentName.get(publicId) ?? publicId).replace(
        /^\d+[-_ ]*/,
        ""
      );
      const nextName = `${prefix}-${suffix}`;
      if (nextName === currentName.get(publicId)) continue;
      await updateDisplayName(publicId, nextName);
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
