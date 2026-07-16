import { PrismaClient } from "@prisma/client";

/**
 * Canonical PrismaClient singleton. Cached on globalThis so Next's dev HMR
 * doesn't spawn a new client (and a new connection pool) on every reload.
 * Connection is lazy — the first query connects — so `next build` never needs a
 * reachable database. See lib/inquiries.ts for the domain helpers on top.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
