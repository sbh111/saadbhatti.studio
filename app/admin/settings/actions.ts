"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/auth";
import {
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
