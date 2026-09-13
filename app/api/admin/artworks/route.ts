import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { META_KEYS, TITLE_KEYS } from "@/lib/catalog";
import {
  reorderCollection,
  updateArtworkContext,
  type ContextFieldUpdate,
} from "@/lib/cloudinaryAdmin";
import { CATALOG_CACHE_TAG } from "@/lib/constants";
import { invalid, unauthorized } from "@/lib/http";

interface EditPayload {
  publicId: string;
  fields: Record<string, string>;
}

interface ReorderPayload {
  collectionPath: string;
  orderedPublicIds: string[];
}

interface RequestBody {
  edits?: EditPayload[];
  reorders?: ReorderPayload[];
}

/**
 * Bulk write for both 1a metadata edits and 1b reorders in one request/one
 * revalidation. Metadata edits merge into each asset's Cloudinary context
 * (allSettled — per-item failures reported, not fatal); reorders renumber
 * filename prefixes sequentially (each returns ok / stale / error). Anything
 * that fails stays staged client-side; a retry heals (reorders are idempotent).
 */
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return unauthorized();
  }

  let body: RequestBody;
  try {
    body = await request.json();
    if (typeof body !== "object" || body === null) throw new Error("bad body");
  } catch {
    return invalid();
  }
  const edits = Array.isArray(body.edits) ? body.edits : [];
  const reorders = Array.isArray(body.reorders) ? body.reorders : [];

  // --- Metadata edits (parallel, as in 1a) ---
  const editResults = await Promise.allSettled(
    edits.map(({ publicId, fields }) => {
      // Each field carries its FULL read chain (TITLE_KEYS / a META_KEYS
      // entry), not just its canonical key — clearing a field has to delete
      // every alias in its chain, or an old one (e.g. a stray `caption`)
      // resurfaces through the catalog's read-side fallback (tech debt 3.2).
      // See lib/cloudinaryAdmin.ts's mergeContext for the clear-vs-set logic.
      const context: ContextFieldUpdate[] = [
        { keys: TITLE_KEYS, value: fields.title ?? "" },
        ...META_KEYS.map(([label, ...keys]) => ({
          keys,
          value: fields[label] ?? "",
        })),
      ];
      return updateArtworkContext(publicId, context);
    })
  );
  const failedEdits = edits
    .filter((_, i) => editResults[i].status === "rejected")
    .map((e) => e.publicId);
  editResults.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`edit save failed for ${edits[i].publicId}:`, r.reason);
    }
  });

  // --- Reorders (sequential — deterministic partial state, rate-limit-safe) ---
  const failedReorders: { path: string; reason: "stale" | "error" }[] = [];
  let savedReorders = 0;
  for (const { collectionPath, orderedPublicIds } of reorders) {
    const result = await reorderCollection(collectionPath, orderedPublicIds);
    if (result.ok) {
      savedReorders++;
    } else {
      if (result.reason === "error") {
        console.error(`reorder failed for ${collectionPath}:`, result.message);
      }
      failedReorders.push({ path: collectionPath, reason: result.reason });
    }
  }

  const savedEdits = edits.length - failedEdits.length;
  if (savedEdits > 0 || savedReorders > 0) {
    revalidateTag(CATALOG_CACHE_TAG, "max");
    revalidatePath("/", "layout");
  }

  return NextResponse.json({
    savedEdits,
    failedEdits,
    savedReorders,
    failedReorders,
  });
}
