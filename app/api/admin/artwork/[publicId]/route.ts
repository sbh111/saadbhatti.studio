import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { META_KEYS } from "@/lib/catalog";
import { updateArtworkContext } from "@/lib/cloudinaryAdmin";

/**
 * Admin metadata write: merges the form's fields into the asset's Cloudinary
 * contextual metadata, then invalidates the catalog cache so the edit is live
 * within seconds instead of the hourly ISR window. This "POST → mutate
 * Cloudinary → revalidate" shape is the pattern Phase 1b's reorder will reuse.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ publicId: string }> }
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { publicId } = await params;
  const form = await request.formData();

  const fields: Record<string, string> = {
    // Always write the title to "Title Name" — the first-priority key in the
    // catalog's read chain; legacy caption/Title keys are left untouched.
    "Title Name": String(form.get("title") ?? ""),
  };
  for (const [label] of META_KEYS) {
    fields[label] = String(form.get(label.toLowerCase()) ?? "");
  }

  try {
    await updateArtworkContext(decodeURIComponent(publicId), fields);
  } catch (error) {
    console.error("artwork context update failed:", error);
    return NextResponse.redirect(new URL("/admin?error=1", request.url), 303);
  }

  revalidateTag("catalog", "max");
  revalidatePath("/", "layout");
  return NextResponse.redirect(new URL("/admin?saved=1", request.url), 303);
}
