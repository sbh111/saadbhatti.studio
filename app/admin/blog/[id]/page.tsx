import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PostStatus } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { content } from "@/lib/content";
import { getPostById } from "@/lib/posts";
import { postHref } from "@/lib/urls";
import DeletePostButton from "@/components/DeletePostButton";
import LocalTime from "@/components/LocalTime";
import PostEditor from "@/components/PostEditor";
import {
  archivePostAction,
  deletePostAction,
  publishPostAction,
  restorePostAction,
  savePostAction,
  unpublishPostAction,
} from "../actions";

export const metadata: Metadata = {
  title: `edit post - ${content.site.title}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  title: "A title is required.",
  excerpt: "That excerpt is too long.",
  body: "That body is too long.",
  slug: "A slug must be lowercase letters, numbers and single dashes.",
  slugtaken: "Another post already uses that slug.",
  excerptrequired: "Add an excerpt before publishing — the index shows it.",
  cover: "That cover image reference is not valid — re-upload the image.",
  coveralt: "That alt text is too long.",
  notarchived: "That post is not archived, so there is nothing to restore.",
  missing: "That post no longer exists.",
};

export default async function EditPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
    published?: string;
    restored?: string;
  }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");

  const { id } = await params;
  const { error, saved, published, restored } = await searchParams;
  const post = await getPostById(id);
  if (!post) notFound();

  const isDraft = post.status === PostStatus.DRAFT;
  const isPublished = post.status === PostStatus.PUBLISHED;
  const isArchived = post.status === PostStatus.ARCHIVED;
  const action =
    "rounded-[2px] border border-hairline px-3 py-1.5 text-[13px] text-ink-muted hover:text-steel";

  return (
    <div className="mx-auto max-w-[760px] px-5 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="font-pixel text-lg leading-relaxed text-ink">
          edit post
        </h1>
        <Link
          href="/admin/blog"
          className="text-[13px] text-ink-faint hover:text-steel"
        >
          ← all posts
        </Link>
      </div>

      <p className="mt-1 text-[13px] text-ink-faint">
        <span className="font-pixel text-[10px] text-steel">{post.status}</span>
        {" · created "}
        <LocalTime date={post.createdAt} />
        {post.publishedAt && (
          <>
            {" · first published "}
            <LocalTime date={post.publishedAt} />
          </>
        )}
      </p>

      {error && ERRORS[error] && (
        <p className="mt-2 text-[13px] text-steel">{ERRORS[error]}</p>
      )}
      {saved && !error && (
        <p className="mt-2 text-[13px] text-ink-muted">Saved.</p>
      )}
      {restored && !error && (
        <p className="mt-2 text-[13px] text-ink-muted">
          Restored to draft.
        </p>
      )}
      {published && !error && (
        <p className="mt-2 text-[13px] text-ink-muted">
          Published —{" "}
          <Link href={postHref(post.slug)} className="hover:text-steel">
            view it
          </Link>
          .
        </p>
      )}

      <PostEditor
        id={post.id}
        initialTitle={post.title}
        initialSlug={post.slug}
        initialExcerpt={post.excerpt}
        initialBody={post.body}
        initialCoverPublicId={post.coverPublicId ?? ""}
        initialCoverAlt={post.coverAlt ?? ""}
        initialCoverWidth={post.coverWidth}
        initialCoverHeight={post.coverHeight}
        slugEditable={isDraft}
        saveAction={savePostAction}
      />

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
        {/* Preview is a separate admin route, not a flag on the public page:
            reading the session at /blog/[slug] would make it dynamic. */}
        <Link href={`/admin/blog/${post.id}/preview`} className={action}>
          preview
        </Link>

        {!isPublished && (
          <form action={publishPostAction}>
            <input type="hidden" name="id" value={post.id} />
            <button type="submit" className={action}>
              {post.publishedAt ? "re-publish" : "publish"}
            </button>
          </form>
        )}

        {isPublished && (
          <>
            <Link href={postHref(post.slug)} className={action}>
              view live
            </Link>
            <form action={unpublishPostAction}>
              <input type="hidden" name="id" value={post.id} />
              <button type="submit" className={action}>
                unpublish
              </button>
            </form>
          </>
        )}

        {/* Archive is reversible, which is what makes it the safe
            alternative to delete: an archived post 404s publicly but stays in
            the admin list, and "restore to draft" brings it back with its
            original publishedAt intact. */}
        {!isArchived && (
          <form action={archivePostAction}>
            <input type="hidden" name="id" value={post.id} />
            <button type="submit" className={action}>
              archive
            </button>
          </form>
        )}

        {isArchived && (
          <form action={restorePostAction}>
            <input type="hidden" name="id" value={post.id} />
            <button type="submit" className={action}>
              restore to draft
            </button>
          </form>
        )}

        <form action={deletePostAction} className="ml-auto">
          <input type="hidden" name="id" value={post.id} />
          <DeletePostButton />
        </form>
      </div>
    </div>
  );
}
