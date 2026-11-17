import { describe, expect, it } from "vitest";
import {
  LOCAL_HOSTS,
  classifyDbTarget,
  isLocalDbTarget,
  parseDotenv,
  resolveDbUrl,
} from "@/scripts/dbTarget.mjs";

/**
 * The guard that stands between a routine Prisma command and the production
 * database (docs/operations.md #3.1). Tested as a classifier because that is
 * what it is: no database, no filesystem, no network — so these cases are
 * cheap enough to be exhaustive about the ways "looks local" can be wrong.
 */

const NEON = "postgresql://u:p@ep-tiny-term-avs49ege.c-11.us-east-1.aws.neon.tech/neondb?sslmode=require";
const LOCAL = "postgresql://sbh:sbh_local_dev@localhost:5432/sbh_studio";

describe("classifyDbTarget — local", () => {
  it("accepts the committed local Docker URL", () => {
    expect(classifyDbTarget(LOCAL)).toEqual({ kind: "local", host: "localhost" });
  });

  it("accepts every host in LOCAL_HOSTS", () => {
    for (const host of LOCAL_HOSTS) {
      // IPv6 literals need brackets in a URL's authority.
      const authority = host === "::1" ? "[::1]" : host;
      const { kind } = classifyDbTarget(`postgresql://u:p@${authority}:5432/db`);
      expect(kind, `${host} should be local`).toBe("local");
    }
  });

  it("accepts a Unix-domain socket path", () => {
    expect(classifyDbTarget("postgresql:///sbh_studio?host=/var/run/postgresql")).toEqual({
      kind: "local",
      host: "/var/run/postgresql",
    });
  });

  it("accepts the postgres:// scheme as well as postgresql://", () => {
    expect(isLocalDbTarget("postgres://u:p@localhost:5432/db")).toBe(true);
  });
});

describe("classifyDbTarget — remote", () => {
  it("rejects the Neon host that was reset", () => {
    const { kind, host } = classifyDbTarget(NEON);
    expect(kind).toBe("remote");
    expect(host).toContain("neon.tech");
  });

  it("rejects a host that merely STARTS WITH a local name", () => {
    // The bug class this module exists to prevent: a substring or prefix test
    // would wave `localhost.attacker.example.com` straight through.
    expect(classifyDbTarget("postgresql://u:p@localhost.attacker.example.com/db").kind).toBe(
      "remote"
    );
  });

  it("rejects a host that merely ENDS WITH a local name", () => {
    expect(classifyDbTarget("postgresql://u:p@notlocalhost/db").kind).toBe("remote");
    expect(classifyDbTarget("postgresql://u:p@evil-db/db").kind).toBe("remote");
  });

  it("rejects a private LAN address", () => {
    // Not loopback, not disposable, and quite possibly someone else's.
    expect(classifyDbTarget("postgresql://u:p@192.168.1.50:5432/db").kind).toBe("remote");
  });

  it("rejects a loopback-lookalike IP", () => {
    expect(classifyDbTarget("postgresql://u:p@127.0.0.1.example.com/db").kind).toBe("remote");
  });
});

describe("classifyDbTarget — fails closed", () => {
  it("treats missing, empty and non-string input as invalid, never local", () => {
    for (const bad of [undefined, null, "", "   "]) {
      expect(classifyDbTarget(bad as never).kind).toBe("invalid");
      expect(isLocalDbTarget(bad as never)).toBe(false);
    }
  });

  it("treats an unparseable URL as invalid", () => {
    expect(classifyDbTarget("not a url at all").kind).toBe("invalid");
  });

  it("rejects a non-Postgres scheme even on a local host", () => {
    // `isLocalDbTarget` is asked about Postgres URLs; anything else reaching it
    // means a caller is confused, and guessing would be the wrong answer.
    expect(classifyDbTarget("http://localhost:5432/db").kind).toBe("invalid");
    expect(classifyDbTarget("file:///tmp/db").kind).toBe("invalid");
  });

  it("never returns local for anything it could not parse", () => {
    const inputs = ["", "x", "postgresql://", "postgres:///db"];
    for (const input of inputs) {
      expect(isLocalDbTarget(input)).toBe(false);
    }
  });
});

describe("parseDotenv", () => {
  it("reads plain, single- and double-quoted values", () => {
    expect(
      parseDotenv(['A=one', 'B="two"', "C='three'"].join("\n"))
    ).toEqual({ A: "one", B: "two", C: "three" });
  });

  it("keeps a URL's query string intact, ampersand and all", () => {
    // The reason this parser exists instead of `source`-ing the file: a shell
    // splits on `&` and backgrounds the remainder.
    const url = "postgresql://u:p@h/db?sslmode=require&channel_binding=require";
    expect(parseDotenv(`DIRECT_URL="${url}"`).DIRECT_URL).toBe(url);
  });

  it("ignores comments, blank lines and malformed entries", () => {
    expect(
      parseDotenv(["# comment", "", "  ", "NOEQUALS", "=novalue", "9BAD=x", "OK=y"].join("\n"))
    ).toEqual({ OK: "y" });
  });

  it("does not expand variables", () => {
    // A guard that evaluates its input is a guard with an attack surface.
    expect(parseDotenv("A=$HOME").A).toBe("$HOME");
  });

  it("keeps an '=' inside a value", () => {
    expect(parseDotenv("TOKEN=abc=def==").TOKEN).toBe("abc=def==");
  });
});

describe("resolveDbUrl", () => {
  it("prefers a real environment variable over the .env file", () => {
    // This precedence is Prisma's, and it is the case that matters: the
    // README's production-migration recipe exports the Neon URLs to override
    // .env, so a guard reading only the file would pass while the command
    // talked to Neon.
    expect(resolveDbUrl("DATABASE_URL", { DATABASE_URL: LOCAL }, { DATABASE_URL: NEON })).toEqual({
      value: NEON,
      source: "environment",
    });
  });

  it("falls back to the file when the variable is absent", () => {
    expect(resolveDbUrl("DATABASE_URL", { DATABASE_URL: LOCAL }, {})).toEqual({
      value: LOCAL,
      source: ".env",
    });
  });

  it("treats a blank environment variable as absent rather than as a value", () => {
    expect(
      resolveDbUrl("DATABASE_URL", { DATABASE_URL: LOCAL }, { DATABASE_URL: "   " }).source
    ).toBe(".env");
  });

  it("reports unset when neither has it", () => {
    expect(resolveDbUrl("DATABASE_URL", {}, {})).toEqual({
      value: undefined,
      source: "unset",
    });
  });
});
