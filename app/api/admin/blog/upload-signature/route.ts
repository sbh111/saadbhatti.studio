import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { isValidPostId } from "@/lib/blogLimits";
import { mintBlogUploadTicket } from "@/lib/cloudinaryUpload";
import { prisma } from "@/lib/db";
import { invalid, str, unauthorized } from "@/lib/http";

/**
 * Mints a short-lived upload ticket scoped to ONE post's Cloudinary folder
 * (`blog/<slug>-<postId>/`), so the admin editor can send an image straight
 * from the browser to Cloudinary.
 *
 * The file never passes through this function: a Vercel serverless function
 * has a 4.5 MB request-body limit and would otherwise spend its whole duration
 * relaying bytes it has no reason to see. What crosses the wire here is ~200
 * bytes of signature. See lib/cloudinaryUpload.ts for what the signature does
 * and does not permit.
 *
 * POST, not GET, although it reads rather than writes: a GET is something a
 * browser or a crawler may prefetch, and a ticket should be minted only when
 * the owner has actually chosen a file.
 *
 * `isAdmin()` is the authoritative check — proxy.ts gates /api/admin/* for UX
 * but is never the security boundary (docs/architecture.md invariant 3).
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isAdmin())) return unauthorized();

  let postId: string;
  try {
    const body: unknown = await request.json();
    postId = str((body as { postId?: unknown } | null)?.postId);
  } catch {
    return invalid();
  }

  // Shape first, because it is the half that matters for safety: the id is
  // interpolated into the folder path that gets SIGNED, so one containing `/`
  // or `.` could sign an upload into a folder of the caller's choosing.
  if (!isValidPostId(postId)) return invalid();

  // Then existence, which is about correctness rather than safety: it makes
  // "every blog/<id>/ folder belongs to a real post" true, instead of a
  // convention that a typo quietly breaks. One indexed primary-key lookup,
  // and the editor cannot reach this route without the post already loading.
  // The slug comes from the database, never from the request body: it is the
  // readable half of the folder name, and taking it from the caller would let
  // a hand-crafted POST name the folder whatever it liked.
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, slug: true },
  });
  if (!post) return invalid();

  try {
    const ticket = mintBlogUploadTicket(post.id, post.slug);
    // no-store belongs on the response as well as the route: a ticket carries
    // a timestamp Cloudinary will reject after an hour, so a cached one is a
    // ticket that silently stops working. It is also post-specific now, which
    // makes serving a cached one to a different editor tab actively wrong.
    return NextResponse.json(ticket, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    // Reaches here only if the Cloudinary credentials are missing, which
    // instrumentation.ts asserts at boot — so this is a 503 rather than a
    // caller error, and the message stays on the server.
    console.error(
      "[blog] upload signature unavailable:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
