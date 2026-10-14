import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";

/**
 * Single-admin session auth. The session is a signed + encrypted HttpOnly
 * cookie (iron-session) carrying one flag; there is no user table. The proxy
 * does a cheap cookie-presence check for UX, but every protected Server
 * Component / Route Handler calls getSession()/isAdmin() as the authoritative
 * check — the proxy is never the sole security boundary.
 *
 * NOTE: proxy.ts duplicates the cookie name as a literal (importing this
 * module there would pull bcryptjs into the edge bundle) — keep them in sync.
 */

const SESSION_COOKIE = "sbh_admin_session";

interface SessionData {
  isAdmin?: boolean;
}

function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password) {
    throw new Error(
      "Missing SESSION_SECRET. Locally: put it in .env.local (see .env.local.example). On Vercel: Project → Settings → Environment Variables."
    );
  }
  return {
    password,
    cookieName: SESSION_COOKIE,
    ttl: 60 * 60 * 24 * 7,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

export async function isAdmin(): Promise<boolean> {
  return (await getSession()).isAdmin === true;
}

export async function verifyCredentials(
  username: string,
  password: string
): Promise<boolean> {
  const expectedUser = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!expectedUser || !passwordHash) return false;
  if (username !== expectedUser) return false;
  return bcrypt.compare(password, passwordHash);
}
