import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";

/** Session status for the client shell's conditional admin nav entry. */
export async function GET() {
  return NextResponse.json({ isAdmin: await isAdmin() });
}
