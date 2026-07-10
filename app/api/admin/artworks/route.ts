import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { META_KEYS } from "@/lib/catalog";
import { updateArtworkContext } from "@/lib/cloudinaryAdmin";

interface EditPayload {
  publicId: string;
  fields: Record<string, string>;
}

/**
 * Bulk metadata write: takes every staged edit at once, merges each into its
 * asset's Cloudinary contextual metadata, then invalidates the catalog cache so
 * changes are live within seconds. Per-item failures are reported back (still
 * staged client-side) rather than failing the whole batch.
 */
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let edits: EditPayload[];
  try {
    edits = await request.json();
    if (!Array.isArray(edits)) throw new Error("expected an array");
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const metaLabels = META_KEYS.map(([label]) => label);
  const results = await Promise.allSettled(
    edits.map(({ publicId, fields }) => {
      // Title → the "Title Name" key (first in the catalog read chain); the
      // rest are the generic metadata labels.
      const context: Record<string, string> = {
        "Title Name": fields.title ?? "",
      };
      for (const label of metaLabels) context[label] = fields[label] ?? "";
      return updateArtworkContext(publicId, context);
    })
  );

  const failed = edits
    .filter((_, i) => results[i].status === "rejected")
    .map((e) => e.publicId);
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`save failed for ${edits[i].publicId}:`, r.reason);
    }
  });

  if (failed.length < edits.length) {
    revalidateTag("catalog", "max");
    revalidatePath("/", "layout");
  }

  return NextResponse.json({ saved: edits.length - failed.length, failed });
}
