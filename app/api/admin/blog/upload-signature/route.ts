import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { mintBlogUploadTicket } from "@/lib/cloudinaryUpload";
import { unauthorized } from "@/lib/http";

/**
 * Mints a short-lived, tightly-scoped Cloudinary upload ticket so the admin
 * editor can send an image straight from the browser to Cloudinary.
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

export async function POST() {
  if (!(await isAdmin())) return unauthorized();

  try {
    const ticket = mintBlogUploadTicket();
    // no-store belongs on the response as well as the route: a ticket carries
    // a timestamp Cloudinary will reject after an hour, so a cached one is a
    // ticket that silently stops working.
    return NextResponse.json(ticket, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    // Reaches here only if the Cloudinary credentials are missing, which
    // instrumentation.ts asserts at boot — so this is a 500 rather than a
    // caller error, and the message stays on the server.
    console.error(
      "[blog] upload signature unavailable:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
