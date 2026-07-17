"use server";

import { revalidatePath } from "next/cache";
import { InquiryStatus } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
