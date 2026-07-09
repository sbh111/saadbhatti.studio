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
