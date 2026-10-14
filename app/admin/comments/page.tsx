import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getArtworkIndex } from "@/lib/catalog";
import { imageUrl } from "@/lib/cloudinary";
import { content } from "@/lib/content";
import { prisma } from "@/lib/db";
import DeleteInquiryButton from "@/components/DeleteInquiryButton";
import InquiryEmailAlert from "@/components/InquiryEmailAlert";
import LocalTime from "@/components/LocalTime";
import {
  deleteInquiryAction,
  resendInquiryEmailAction,
  toggleReadAction,
} from "./actions";

export const metadata: Metadata = {
  title: `comment log - ${content.site.title}`,
  robots: { index: false },
};

// First dynamic page: it reads the session and the DB on every request. Declared
// explicitly as documentation-of-intent (nothing here is cacheable).
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Offset pagination, not keyset: this table holds sales leads, not a firehose —
 * even a busy year is a few thousand rows, so `skip`/`take` never has enough
 * rows ahead of it to make the extra offset scan cost anything measurable. In
 * exchange it gets arbitrary page numbers (jump to page 6, not just "next"),
 * which a `?page=` link needs to survive being pasted, refreshed, or bookmarked
 * across admin sessions — a cursor would have to be threaded through instead.
 */
function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export default async function CommentLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");

  const { page: rawPage } = await searchParams;
  const total = await prisma.inquiry.count();
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Garbage or out-of-range input (a stale bookmark after deletes shrink the
  // table, a hand-edited URL) clamps back into range rather than rendering an
  // empty page or erroring.
  const page = Math.min(parsePage(rawPage), pageCount);

  // The catalog only supplies a thumbnail + link (every inquiry already
  // carries its own snapshotted artworkTitle) — a Cloudinary outage must not
  // take the comment log down with it (tech debt 1.4). Run it alongside the
  // DB query for latency, but `.catch` it separately: if it rejects, this
  // page still renders from the database alone, just without thumbnails or
  // deep links.
  const [inquiries, indexResult] = await Promise.all([
    prisma.inquiry.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    getArtworkIndex().catch((err) => {
      console.error("[admin/comments] catalog unavailable:", err);
      return null;
    }),
  ]);
  const catalogUnavailable = indexResult === null;
  const index: Awaited<ReturnType<typeof getArtworkIndex>> =
    indexResult ?? new Map();

  return (
    <div className="mx-auto max-w-[760px] px-5 py-8">
      <h1 className="font-pixel text-lg leading-relaxed text-ink">
        comment log
      </h1>
      <p className="mt-1 text-[13px] text-ink-faint">
        {total === 0
          ? "No inquiries yet."
          : `${total} inquir${total === 1 ? "y" : "ies"} · page ${page} of ${pageCount}`}
      </p>
      {catalogUnavailable && (
        <p className="mt-1 text-[13px] text-steel">
          Catalog unavailable — showing titles and messages only, no
          thumbnails or links.
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {inquiries.map((inquiry) => {
          const ref = index.get(inquiry.artworkPublicId);
          const isNew = inquiry.status === "NEW";
          return (
            <li
              key={inquiry.id}
              className={`rounded-[2px] border border-hairline bg-panel p-3 ${
                isNew ? "" : "opacity-60"
              }`}
            >
              <div className="flex gap-3">
                {/* No catalog → no Cloudinary thumbnail (the outage that took
                    the catalog down almost certainly took image delivery down
                    with it) — a plain placeholder box instead of a broken img. */}
                {catalogUnavailable ? (
                  <div className="h-16 w-24 shrink-0 rounded-[1px] bg-placeholder" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl(inquiry.artworkPublicId, 200)}
                    alt=""
                    className="h-16 w-24 shrink-0 rounded-[1px] bg-placeholder object-cover"
                  />
                )}
                <div className="min-w-0 grow">
                  <div className="flex items-center gap-2">
                    {isNew && (
                      <span className="font-pixel text-[10px] text-steel">
                        NEW
                      </span>
                    )}
                    {ref ? (
                      <Link
                        href={`/${ref.mediumSlug}/${ref.collectionSlug}#${ref.artwork.slug}`}
                        className="truncate text-[15px] font-medium text-ink hover:text-steel"
                      >
                        {ref.artwork.name}
                      </Link>
                    ) : (
                      <span className="truncate text-[15px] font-medium text-ink">
                        {inquiry.artworkTitle}{" "}
                        {!catalogUnavailable && (
                          <span className="text-ink-faint">
                            (no longer listed)
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[13px] text-ink-muted">
                    {inquiry.name} ·{" "}
                    <a
                      href={`mailto:${inquiry.email}`}
                      className="hover:text-steel"
                    >
                      {inquiry.email}
                    </a>{" "}
                    · <LocalTime date={inquiry.createdAt} />
                  </div>
                </div>
              </div>

              <p className="mt-2 whitespace-pre-wrap text-[15px] text-ink">
                {inquiry.message}
              </p>

              <div className="mt-3 flex items-center gap-4 border-t border-hairline pt-2">
                {inquiry.emailStatus !== "SENT" && (
                  <InquiryEmailAlert
                    inquiryId={inquiry.id}
                    status={inquiry.emailStatus}
                    error={inquiry.emailError}
                    resendAction={resendInquiryEmailAction}
                  />
                )}
                <form action={toggleReadAction}>
                  <input type="hidden" name="id" value={inquiry.id} />
                  <input
                    type="hidden"
                    name="to"
                    value={isNew ? "READ" : "NEW"}
                  />
                  <button
                    type="submit"
                    className="text-[13px] text-ink-faint hover:text-steel"
                  >
                    {isNew ? "mark read" : "mark unread"}
                  </button>
                </form>
                <form action={deleteInquiryAction}>
                  <input type="hidden" name="id" value={inquiry.id} />
                  <DeleteInquiryButton />
                </form>
              </div>
            </li>
          );
        })}
      </ul>

      {pageCount > 1 && (
        <div className="mt-6 flex items-center justify-between border-t border-hairline pt-3 text-[13px]">
          {page > 1 ? (
            <Link
              href={`/admin/comments?page=${page - 1}`}
              className="text-ink-faint hover:text-steel"
            >
              ← newer
            </Link>
          ) : (
            <span className="text-ink-faint opacity-40">← newer</span>
          )}
          <span className="text-ink-faint">
            page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <Link
              href={`/admin/comments?page=${page + 1}`}
              className="text-ink-faint hover:text-steel"
            >
              older →
            </Link>
          ) : (
            <span className="text-ink-faint opacity-40">older →</span>
          )}
        </div>
      )}
    </div>
  );
}
