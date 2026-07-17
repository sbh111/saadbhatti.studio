import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getArtworkIndex } from "@/lib/catalog";
import { imageUrl } from "@/lib/cloudinary";
import { content } from "@/lib/content";
import { prisma } from "@/lib/db";
import DeleteInquiryButton from "@/components/DeleteInquiryButton";
import { deleteInquiryAction, toggleReadAction } from "./actions";

export const metadata: Metadata = {
  title: `comment log - ${content.site.title}`,
  robots: { index: false },
};

// First dynamic page: it reads the session and the DB on every request. Declared
// explicitly as documentation-of-intent (nothing here is cacheable).
export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;

const dateFmt = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function CommentLogPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const [inquiries, index] = await Promise.all([
    prisma.inquiry.findMany({
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
    getArtworkIndex(),
  ]);

  return (
    <div className="mx-auto max-w-[760px] px-5 py-8">
      <h1 className="font-pixel text-lg leading-relaxed text-ink">
        comment log
      </h1>
      <p className="mt-1 text-[13px] text-ink-faint">
        {inquiries.length === 0
          ? "No inquiries yet."
          : `${inquiries.length} inquir${inquiries.length === 1 ? "y" : "ies"}`}
      </p>

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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(inquiry.artworkPublicId, 200)}
                  alt=""
                  className="h-16 w-24 shrink-0 rounded-[1px] bg-placeholder object-cover"
                />
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
                        <span className="text-ink-faint">(no longer listed)</span>
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
                    · {dateFmt.format(inquiry.createdAt)}
                  </div>
                </div>
              </div>

              <p className="mt-2 whitespace-pre-wrap text-[15px] text-ink">
                {inquiry.message}
              </p>

              <div className="mt-3 flex items-center gap-4 border-t border-hairline pt-2">
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

      {inquiries.length === PAGE_SIZE && (
        <p className="mt-6 text-[13px] text-ink-faint">
          Showing latest {PAGE_SIZE}.
        </p>
      )}
    </div>
  );
}
