import type { ReactNode } from "react";

/**
 * Shared shell for the three subscription outcome pages.
 *
 * These live at `/subscribe/*` rather than under `/blog/` for two concrete
 * reasons: a page at `/blog/confirm` would silently steal the slug `confirm`
 * from the post namespace (Next resolves a static segment before `[slug]`),
 * and it would sit inside the namespace `scripts/assert-static-routes.mjs`
 * polices for prerendered children.
 *
 * All three are fully static — no `searchParams`, no session, no database, no
 * `cookies()`. The outcome is communicated by WHICH page you land on, never by
 * a query parameter, so there is nothing for anyone to forge and nothing to
 * render per request.
 */
export default function SubscribeLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[680px] px-[30px] py-[34px]">{children}</div>
  );
}
