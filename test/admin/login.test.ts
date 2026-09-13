import { describe, expect, it, vi } from "vitest";

// AdminLoginPage is a Server Component: only isAdmin() gates the redirect
// under test here. next/navigation's redirect() throws NEXT_REDIRECT, which
// we catch and inspect rather than mocking it away, so the assertion matches
// exactly what Next would actually navigate to.
const isAdmin = vi.fn();
vi.mock("@/lib/auth", () => ({ isAdmin: (...args: unknown[]) => isAdmin(...args) }));

const { default: AdminLoginPage } = await import("@/app/admin/login/page");

function searchParams(error?: string) {
  return Promise.resolve(error === undefined ? {} : { error });
}

async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    // next/navigation's redirect() throws a digest string of the form
    // "NEXT_REDIRECT;push;<url>;...".
    const digest = (err as { digest?: string }).digest ?? "";
    const [, , url] = digest.split(";");
    return url;
  }
  throw new Error("expected redirect() to throw");
}

describe("AdminLoginPage", () => {
  it("redirects an already-logged-in admin to the comment log, not /admin", async () => {
    isAdmin.mockResolvedValue(true);
    const target = await redirectTarget(
      AdminLoginPage({ searchParams: searchParams() })
    );
    expect(target).toBe("/admin/comments");
  });

  it("renders the login form (no redirect) for a logged-out visitor", async () => {
    isAdmin.mockResolvedValue(false);
    const result = await AdminLoginPage({ searchParams: searchParams() });
    expect(result).toBeTruthy();
  });
});
