"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/auth";
import {
  COMMENTS_ENABLED_KEY,
  COMMENT_AUTO_PUBLISH_KEY,
  NOTIFY_SUBSCRIBERS_KEY,
  EVENT_STREAMING_KEY,
  invalidateStreamingCache,
  setSetting,
} from "@/lib/settings";

/**
 * Flip the event-streaming toggle. Server Action on the settings page (the
 * loginAction / comment-log precedent). The proxy gates the page, but this
 * re-checks isAdmin() as the authoritative boundary.
 */
export async function setEventStreamingAction(formData: FormData) {
  if (!(await isAdmin())) return;
  const on = String(formData.get("to")) === "on";
  await setSetting(EVENT_STREAMING_KEY, on ? "true" : "false");
  invalidateStreamingCache(); // this instance reflects the change immediately
  revalidatePath("/admin/settings");
}

/**
 * Flip a blog setting. One action for all three keys, with the key coming
 * from the form — but validated against an ALLOWLIST, never used as submitted.
 * A `key` field taken on trust would let any admin form write any row in the
 * generic `settings` table, which is a wider hole than this page needs.
 *
 * Unlike event streaming, neither of these is cached in process, so there is
 * nothing to invalidate: the comment route reads them per request.
 */
const TOGGLEABLE = new Set<string>([
  COMMENTS_ENABLED_KEY,
  COMMENT_AUTO_PUBLISH_KEY,
  NOTIFY_SUBSCRIBERS_KEY,
]);

export async function setBlogSettingAction(formData: FormData) {
  if (!(await isAdmin())) return;
  const key = String(formData.get("key"));
  if (!TOGGLEABLE.has(key)) return;
  const on = String(formData.get("to")) === "on";
  await setSetting(key, on ? "true" : "false");
  revalidatePath("/admin/settings");
}
