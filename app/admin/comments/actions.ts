"use server";

import { revalidatePath } from "next/cache";
import { EmailStatus, InquiryStatus } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { getArtworkIndex } from "@/lib/catalog";
import { prisma } from "@/lib/db";
import { sendInquiryNotification } from "@/lib/mail";

/**
 * Single-row mutations for the admin comment log. Server Actions (not a route
 * handler) — these are form submissions on a server page, following the
 * loginAction precedent. The proxy gates the page, but each action re-checks
 * isAdmin() as the authoritative boundary.
 */

export async function toggleReadAction(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const status =
    String(formData.get("to")) === "READ"
      ? InquiryStatus.READ
      : InquiryStatus.NEW;
  await prisma.inquiry.update({ where: { id }, data: { status } });
  revalidatePath("/admin/comments");
}

export async function deleteInquiryAction(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.inquiry.delete({ where: { id } });
  revalidatePath("/admin/comments");
}

/**
 * Manually (re)send the notification email for an inquiry whose automatic send
 * was skipped (daily cap / unconfigured) or failed. A deliberate admin action,
 * so it is NOT subject to the daily email cap. The outcome is written back to the
 * row, so a repeat failure keeps the alert (with the fresh error) and a success
 * clears it. Artwork slugs come from the live catalog; if the artwork has since
 * been delisted the email still sends with the snapshotted title.
 */
export async function resendInquiryEmailAction(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry) return;

  const ref = (await getArtworkIndex()).get(inquiry.artworkPublicId);
  try {
    const dispatched = await sendInquiryNotification({
      name: inquiry.name,
      email: inquiry.email,
      message: inquiry.message,
      artworkTitle: inquiry.artworkTitle,
      artworkPublicId: inquiry.artworkPublicId,
      artworkSlug: ref?.artwork.slug ?? "",
      mediumSlug: ref?.mediumSlug ?? "",
      collectionSlug: ref?.collectionSlug ?? "",
    });
    await prisma.inquiry.update({
      where: { id },
      data: dispatched
        ? { emailStatus: EmailStatus.SENT, emailError: null }
        : {
            emailStatus: EmailStatus.SKIPPED,
            emailError: "Email notifications are not configured",
          },
    });
  } catch (err) {
    await prisma.inquiry.update({
      where: { id },
      data: {
        emailStatus: EmailStatus.FAILED,
        emailError: (err instanceof Error ? err.message : "Unknown send error").slice(
          0,
          500
        ),
      },
    });
  }
  revalidatePath("/admin/comments");
}
