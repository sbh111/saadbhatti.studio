import { NextResponse, type NextRequest } from "next/server";
import { getArtworkIndex } from "@/lib/catalog";
import { unauthorized } from "@/lib/http";

/**
 * Machine endpoint: the list of artwork public_ids, for the offline CLIP embedder
 * (embed/) to know what to re-embed.
 *
 * Deliberately NOT under /api/admin — that path's proxy requires a browser session
 * cookie, which a container/script doesn't have. Instead it self-authenticates with
 * a bearer token (CATALOG_INDEX_TOKEN), the same machine-client pattern as the event
 * collector. public_ids are already public (they appear in image URLs); the token
 * just keeps this from being a free enumeration endpoint.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = process.env.CATALOG_INDEX_TOKEN;
  const auth = request.headers.get("authorization");
  if (!token || auth !== `Bearer ${token}`) {
    return unauthorized();
  }

  const index = await getArtworkIndex();
  return NextResponse.json({ publicIds: Array.from(index.keys()) });
}
