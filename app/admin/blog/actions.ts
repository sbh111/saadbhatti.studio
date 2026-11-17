"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, PostStatus } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { BLOG_CACHE_TAG, blogPostTag } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { boundedStr, str } from "@/lib/http";
import {
  BODY_MAX,
  COVER_ALT_MAX,
  EXCERPT_MAX,
  TITLE_MAX,
  isValidCoverPublicId,
  isValidSlug,
  parseCoverDimension,
} from "@/lib/blogLimits";
import { uniqueSlugFor } from "@/lib/posts";

/**
 * The post lifecycle: create → save draft → publish → unpublish / archive →
 * delete. Server Actions on the admin pages, following the comment-log and
 * settings precedents. proxy.ts gates the pages, but every action re-checks
 * isAdmin() as the authoritative boundary (docs/architecture.md invariant 3).
 *
 * Errors surface the way loginAction's do — a redirect carrying `?error=`,
 * which the page renders. There is no useActionState anywhere in this
 * codebase and this is not the place to introduce it.
 */

/**
 * Drop every cached read that could now be stale.
 *
 * `updateTag` rather than `revalidateTag(tag, "max")`: it is Server-Action-only
 * (it throws from a route handler — see next/dist/server/web/spec-extension/
 * revalidate.js) and it expires immediately, which is what gives
 * read-your-own-writes. Clicking "publish" and then "view post" must show the
 * post, not the pre-publish cache. A route handler would have to use
 * revalidateTag instead, as app/api/admin/artworks/route.ts does.
 *
 * `revalidatePath` on top is belt-and-braces, mirroring that same route
 * handler. `/blog/<slug>` is a concrete path, not a dynamic one, so it needs
 * no `type` argument.
 */
function revalidateBlog(slug?: string) {
  updateTag(BLOG_CACHE_TAG);
  if (slug) updateTag(blogPostTag(slug));
  revalidatePath("/blog");
  if (slug) revalidatePath(`/blog/${slug}`);
  revalidatePath("/admin/blog");
}

export async function createPostAction(formData: FormData) {
  if (!(await isAdmin())) return;
  const title = boundedStr(formData.get("title"), TITLE_MAX);
  if (!title) redirect("/admin/blog?error=title");

  const slug = await uniqueSlugFor(title);
  let id: string;
  try {
    const created = await prisma.post.create({
      // Excerpt and body start empty: a new post is a DRAFT, and the point of
      // a draft is that it is incomplete. They are validated on publish.
      data: { title, slug, excerpt: "", body: "", status: PostStatus.DRAFT },
      select: { id: true },
    });
    id = created.id;
  } catch (err) {
    // uniqueSlugFor checked, but two concurrent creates could both pass it —
    // the unique constraint is the real guarantee, so a collision is a
    // retryable condition rather than a crash.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      redirect("/admin/blog?error=slug");
    }
    throw err;
  }

  revalidatePath("/admin/blog");
  redirect(`/admin/blog/${id}`);
}

export async function savePostAction(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;

  const existing = await prisma.post.findUnique({
    where: { id },
    select: { slug: true, status: true },
  });
  if (!existing) redirect("/admin/blog?error=missing");

  const title = boundedStr(formData.get("title"), TITLE_MAX);
  if (!title) redirect(`/admin/blog/${id}?error=title`);

  // Excerpt and body may legitimately be empty on a draft, so they are
  // length-capped rather than required here. publishPostAction is where
  // completeness is enforced.
  const excerpt = str(formData.get("excerpt"));
  if (excerpt.length > EXCERPT_MAX) redirect(`/admin/blog/${id}?error=excerpt`);
  const body = str(formData.get("body"));
  if (body.length > BODY_MAX) redirect(`/admin/blog/${id}?error=body`);

  // The slug is only editable while the post is a DRAFT. Once published it is
  // a permanent public contract — changing it breaks every link ever shared,
  // the same lesson tech debt 1.8 recorded for artwork anchors. A submitted
  // slug on a published post is ignored, not rejected: the field isn't
  // rendered, so its presence means a hand-crafted request.
  let slug = existing.slug;
  if (existing.status === PostStatus.DRAFT) {
    const submitted = str(formData.get("slug"));
    if (submitted && submitted !== existing.slug) {
      if (!isValidSlug(submitted)) redirect(`/admin/blog/${id}?error=slug`);
      const clash = await prisma.post.findFirst({
        where: { slug: submitted, id: { not: id } },
        select: { id: true },
      });
      if (clash) redirect(`/admin/blog/${id}?error=slugtaken`);
      slug = submitted;
    }
  }

  // ── Cover image ───────────────────────────────────────────────────────
  // The browser uploaded straight to Cloudinary and put the resulting
  // public_id in a hidden input; what arrives here is a reference, never
  // bytes. An empty public_id means "remove the cover", which detaches it
  // from the post — the asset itself is left alone, because nothing in this
  // app ever deletes from Cloudinary (docs/architecture.md).
  //
  // Validated rather than trusted even though only the owner can submit it:
  // this value is interpolated into a delivery URL, and a signed upload
  // ticket does not constrain what a hand-crafted POST can put in this field.
  let cover: {
    coverPublicId: string | null;
    coverAlt: string | null;
    coverWidth: number | null;
    coverHeight: number | null;
  } = {
    coverPublicId: null,
    coverAlt: null,
    coverWidth: null,
    coverHeight: null,
  };
  const submittedCover = str(formData.get("coverPublicId"));
  if (submittedCover) {
    if (!isValidCoverPublicId(submittedCover)) {
      redirect(`/admin/blog/${id}?error=cover`);
    }
    const alt = str(formData.get("coverAlt"));
    if (alt.length > COVER_ALT_MAX) {
      redirect(`/admin/blog/${id}?error=coveralt`);
    }
    cover = {
      coverPublicId: submittedCover,
      // "" is kept as "" rather than coerced to null: an empty alt is a
      // deliberate statement that the image is decorative, and `alt=""` is
      // the correct output for that. Null would mean "never filled in".
      coverAlt: alt,
      // Absent or implausible dimensions degrade to null rather than
      // rejecting the save — they are a layout nicety, and an older row that
      // predates them must stay editable.
      coverWidth: parseCoverDimension(formData.get("coverWidth")) ?? null,
      coverHeight: parseCoverDimension(formData.get("coverHeight")) ?? null,
    };
  }

  await prisma.post.update({
    where: { id },
    data: { title, excerpt, body, slug, ...cover },
  });

  // Both slugs: the old one so its cached page stops serving stale content,
  // the new one so it is fetched fresh.
  revalidateBlog(existing.slug);
  if (slug !== existing.slug) revalidateBlog(slug);
  redirect(`/admin/blog/${id}?saved=1`);
}

export async function publishPostAction(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;

  const existing = await prisma.post.findUnique({
    where: { id },
    select: { slug: true, excerpt: true, publishedAt: true },
  });
  if (!existing) redirect("/admin/blog?error=missing");

  // The public index renders an excerpt for every post, so publishing without
  // one would ship a blank card. Enforced here rather than on save, so a
  // draft can be saved half-finished.
  if (!existing.excerpt.trim()) {
    redirect(`/admin/blog/${id}?error=excerptrequired`);
  }

  await prisma.post.update({
    where: { id },
    data: {
      status: PostStatus.PUBLISHED,
      // `??` not `||`: set on the FIRST publish and preserved thereafter, so
      // re-publishing an old post does not jump it to the top of the index.
      publishedAt: existing.publishedAt ?? new Date(),
    },
  });

  revalidateBlog(existing.slug);
  redirect(`/admin/blog/${id}?published=1`);
}

/** Back to DRAFT. `publishedAt` is deliberately left untouched. */
export async function unpublishPostAction(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const existing = await prisma.post.findUnique({
    where: { id },
    select: { slug: true },
  });
  if (!existing) return;

  await prisma.post.update({
    where: { id },
    data: { status: PostStatus.DRAFT },
  });
  revalidateBlog(existing.slug);
  redirect(`/admin/blog/${id}`);
}

/** 404s publicly, but stays in the admin list — not a delete. */
export async function archivePostAction(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const existing = await prisma.post.findUnique({
    where: { id },
    select: { slug: true },
  });
  if (!existing) return;

  await prisma.post.update({
    where: { id },
    data: { status: PostStatus.ARCHIVED },
  });
  revalidateBlog(existing.slug);
  redirect(`/admin/blog/${id}`);
}

/**
 * ARCHIVED → DRAFT. The inverse of `archivePostAction`, and the reason
 * archiving is safe to use freely.
 *
 * A separate action rather than reusing `unpublishPostAction` (which would do
 * the same write) because the status guard below makes the intent explicit:
 * this only ever touches an archived post, so a stale form or a double-click
 * cannot quietly unpublish a live one. `publishedAt` is left untouched, so a
 * post that is archived and later re-published keeps its original date and
 * does not jump to the top of the index.
 */
export async function restorePostAction(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const existing = await prisma.post.findUnique({
    where: { id },
    select: { slug: true, status: true },
  });
  if (!existing) return;
  if (existing.status !== PostStatus.ARCHIVED) {
    redirect(`/admin/blog/${id}?error=notarchived`);
  }

  await prisma.post.update({
    where: { id },
    data: { status: PostStatus.DRAFT },
  });
  revalidateBlog(existing.slug);
  redirect(`/admin/blog/${id}?restored=1`);
}

export async function deletePostAction(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const existing = await prisma.post.findUnique({
    where: { id },
    select: { slug: true },
  });
  if (!existing) return;

  // Phase 0 has no child tables. When Phase 2 adds post_likes and
  // post_comments they carry a real FK with ON DELETE CASCADE, so this stays a
  // single delete rather than growing into a transaction.
  await prisma.post.delete({ where: { id } });
  revalidateBlog(existing.slug);
  redirect("/admin/blog");
}
