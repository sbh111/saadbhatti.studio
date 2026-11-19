import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CommentStatus } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import {
  MODERATION_PAGE_SIZE,
  countCommentsByStatus,
  listCommentsForModeration,
} from "@/lib/comments";
import { content } from "@/lib/content";
import { postHref } from "@/lib/urls";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import LocalTime from "@/components/LocalTime";
import {
  approveCommentAction,
  deleteCommentAction,
  holdCommentAction,
  markCommentSpamAction,
} from "./actions";

/**
 * The comment moderation queue.
 *
 * This route used to be the private inquiry log, which moved to
 * `/admin/inquiries` on 2026-11-18 — the name was always wrong there (it has
 * never held a comment) and keeping both under "comments" would have meant two
 * unrelated admin pages with the same name forever.
 *
 * Paginated and status-filtered from the first commit. The inquiry log shipped
 * with a hard 200-row ceiling and had to be retrofitted (tech debt 2.7); the
 * lesson was cheap to apply here.
 */

export const metadata: Metadata = {
  title: `post comments - ${content.site.title}`,
  robots: { index: false },
};

// Reads the session and the database on every request, and must show held and
// binned comments. Nothing here is cacheable.
export const dynamic = "force-dynamic";

/**
 * The filter lives in the URL rather than in client state, so a view is
 * bookmarkable and survives a refresh — the same reasoning the post list's
 * `?status=` and the inquiry log's `?page=` record. An unrecognised value
 * falls back to the held queue rather than erroring on a hand-edited URL.
 */
const FILTERS = {
  held: CommentStatus.HELD,
  published: CommentStatus.PUBLISHED,
  spam: CommentStatus.SPAM,
  all: undefined,
} as const;

type FilterKey = keyof typeof FILTERS;

function parseFilter(raw: string | undefined): FilterKey {
  return raw && raw in FILTERS ? (raw as FilterKey) : "held";
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export default async function PostCommentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");

  const { status: rawStatus, page: rawPage } = await searchParams;
  const filter = parseFilter(rawStatus);
  const status = FILTERS[filter];

  const counts = await countCommentsByStatus();
  const total =
    status === undefined
      ? counts.HELD + counts.PUBLISHED + counts.SPAM
      : counts[status];
  const pageCount = Math.max(1, Math.ceil(total / MODERATION_PAGE_SIZE));
  // Clamped, so a hand-edited ?page=999 lands on the last page rather than on
  // an empty one — the inquiry log's precedent.
  const page = Math.min(parsePage(rawPage), pageCount);

  const comments = await listCommentsForModeration(status, page);

  const tabs: { key: FilterKey; label: string; count: number }[] = [
    { key: "held", label: "held", count: counts.HELD },
    { key: "published", label: "published", count: counts.PUBLISHED },
    { key: "spam", label: "spam", count: counts.SPAM },
    {
      key: "all",
      label: "all",
      count: counts.HELD + counts.PUBLISHED + counts.SPAM,
    },
  ];

  const action =
    "rounded-[2px] border border-hairline px-2.5 py-1 text-[13px] text-ink-muted hover:text-steel";

  return (
    <div className="mx-auto max-w-[760px] px-5 py-8">
      <h1 className="font-pixel text-lg leading-relaxed text-ink">
        post comments
      </h1>
      <p className="mt-1 text-[13px] text-ink-faint">
        Everything arrives held until you approve it, or until you switch
        auto-publish on in settings.
      </p>

      <nav className="mt-6 flex gap-4 border-b border-hairline pb-2 text-[13px]">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/admin/comments?status=${tab.key}`}
            className={
              tab.key === filter ? "text-ink" : "text-ink-faint hover:text-steel"
            }
          >
            {tab.label} ({tab.count})
          </Link>
        ))}
      </nav>

      {comments.length === 0 ? (
        <p className="mt-6 text-[13px] text-ink-faint">
          {filter === "held" ? "Nothing waiting." : `No ${filter} comments.`}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="rounded-[2px] border border-hairline bg-panel p-3"
            >
              <div className="flex flex-wrap items-baseline gap-2 text-[13px]">
                <span className="font-pixel text-[10px] text-steel">
                  {comment.status}
                </span>
                <span className="font-medium text-ink">
                  {comment.authorName}
                </span>
                {comment.isOwner && (
                  <span className="font-pixel text-[9px] text-steel">
                    AUTHOR
                  </span>
                )}
                <span className="text-ink-faint">
                  <LocalTime date={comment.createdAt} />
                </span>
                <span className="text-ink-faint">
                  on{" "}
                  <Link
                    href={postHref(comment.post.slug)}
                    className="hover:text-steel"
                  >
                    {comment.post.title}
                  </Link>
                </span>
              </div>

              {/* A React text node, so it is escaped. Never rendered through
                  renderMarkdown and never linkified — invariant 13, and
                  linkifying would actively reward link spam. */}
              <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
                {comment.body}
              </p>

              {comment.spamReason && (
                // Visible HERE and nowhere else: telling the commenter which
                // rule they tripped tells a spammer how to route around it.
                <p className="mt-1.5 text-[13px] text-ink-faint">
                  held: {comment.spamReason}
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {comment.status !== CommentStatus.PUBLISHED && (
                  <form action={approveCommentAction}>
                    <input type="hidden" name="id" value={comment.id} />
                    <button type="submit" className={action}>
                      approve
                    </button>
                  </form>
                )}
                {comment.status === CommentStatus.PUBLISHED && (
                  <form action={holdCommentAction}>
                    <input type="hidden" name="id" value={comment.id} />
                    <button type="submit" className={action}>
                      hold
                    </button>
                  </form>
                )}
                {comment.status !== CommentStatus.SPAM && (
                  <form action={markCommentSpamAction}>
                    <input type="hidden" name="id" value={comment.id} />
                    <button type="submit" className={action}>
                      spam
                    </button>
                  </form>
                )}
                <form action={deleteCommentAction} className="ml-auto">
                  <input type="hidden" name="id" value={comment.id} />
                  <ConfirmSubmitButton
                    label="delete"
                    confirm="Delete this comment? This can't be undone — use spam if you only want it hidden."
                    className={action}
                  />
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav className="mt-6 flex items-center gap-4 text-[13px]">
          {page > 1 ? (
            <Link
              href={`/admin/comments?status=${filter}&page=${page - 1}`}
              className="text-ink-muted hover:text-steel"
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
              href={`/admin/comments?status=${filter}&page=${page + 1}`}
              className="text-ink-muted hover:text-steel"
            >
              older →
            </Link>
          ) : (
            <span className="text-ink-faint opacity-40">older →</span>
          )}
        </nav>
      )}
    </div>
  );
}
