import type { Metadata } from "next";
import Link from "next/link";
import { content } from "@/lib/content";
import { blogHref } from "@/lib/urls";

export const metadata: Metadata = {
  title: `that link didn't work — ${content.site.title}`,
  // Nothing here is worth indexing, and an indexed outcome page would be a
  // confusing search result for someone who never subscribed.
  robots: { index: false },
};

export default function Page() {
  return (
    <>
      <h1 className="font-pixel text-xl leading-relaxed text-ink">that link didn&apos;t work</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
        It may have already been used, or it may have expired — confirmation links are good for seven days. Sign up again from the blog and a fresh one will arrive.
      </p>
      <p className="mt-6 text-[13px]">
        <Link href={blogHref()} className="text-ink-faint hover:text-steel">
          ← back to the blog
        </Link>
      </p>
    </>
  );
}
