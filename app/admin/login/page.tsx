import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { content } from "@/lib/content";
import { isAdmin } from "@/lib/auth";
import { loginAction } from "./actions";

export const metadata: Metadata = {
  title: `admin login - ${content.site.title}`,
  robots: { index: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // /admin has no page of its own (see lib/nav.ts) — send an already-logged-in
  // admin to the comment log, the admin's main page, instead of a bare 404.
  if (await isAdmin()) redirect("/admin/comments");
  const { error } = await searchParams;

  const inputClasses =
    "w-full rounded-[2px] border border-hairline bg-page px-3 py-2 text-[15px] text-ink outline-none focus:border-steel";

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-5">
      <form action={loginAction} className="w-full max-w-[320px]">
        <h1 className="font-pixel text-lg leading-relaxed text-ink">
          admin login
        </h1>
        {error && (
          <p className="mt-3 text-[15px] text-steel">
            Wrong username or password. Try again.
          </p>
        )}
        <label className="mt-5 block text-[15px] text-ink-muted">
          Username
          <input
            name="username"
            autoComplete="username"
            required
            className={`mt-1 ${inputClasses}`}
          />
        </label>
        <label className="mt-4 block text-[15px] text-ink-muted">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={`mt-1 ${inputClasses}`}
          />
        </label>
        <button
          type="submit"
          className="mt-6 w-full rounded-[2px] bg-steel px-3 py-2 text-[15px] font-medium text-page hover:opacity-90"
        >
          Log in
        </button>
      </form>
    </div>
  );
}
