import { describe, expect, it } from "vitest";
import { assertRequiredEnv, missingEnvVars, REQUIRED_ENV_VARS } from "@/lib/env";

// Pure functions (no process.env access inside), so a full env snapshot can
// be constructed by hand — no need to mutate the real process.env anywhere
// in this file (which would risk leaking into other test files).

const FULL_ENV: Record<string, string> = Object.fromEntries(
  REQUIRED_ENV_VARS.map((name) => [name, `value-for-${name}`])
);

describe("missingEnvVars", () => {
  it("returns [] when every required var is set to a non-empty string", () => {
    expect(missingEnvVars(FULL_ENV)).toEqual([]);
  });

  it("reports a var that's entirely absent from the env object", () => {
    const { IP_HASH_SALT: _drop, ...rest } = FULL_ENV;
    expect(missingEnvVars(rest)).toEqual(["IP_HASH_SALT"]);
  });

  it("treats an empty string the same as missing", () => {
    // An accidentally-blank Vercel env var is not a valid secret.
    expect(missingEnvVars({ ...FULL_ENV, SESSION_SECRET: "" })).toEqual([
      "SESSION_SECRET",
    ]);
  });

  it("reports every missing var at once, not just the first", () => {
    const sparse = { DATABASE_URL: "x" };
    const missing = missingEnvVars(sparse);
    expect(missing).toEqual(
      REQUIRED_ENV_VARS.filter((name) => name !== "DATABASE_URL")
    );
  });

  it("an empty env object reports all required vars missing", () => {
    expect(missingEnvVars({})).toEqual([...REQUIRED_ENV_VARS]);
  });
});

describe("assertRequiredEnv", () => {
  it("does not throw when every required var is present", () => {
    expect(() => assertRequiredEnv(FULL_ENV)).not.toThrow();
  });

  it("throws one error naming every missing var, not just the first", () => {
    const { IP_HASH_SALT: _a, SESSION_SECRET: _b, ...rest } = FULL_ENV;
    let message = "";
    try {
      assertRequiredEnv(rest);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("IP_HASH_SALT");
    expect(message).toContain("SESSION_SECRET");
  });
});
