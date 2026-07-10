"use server";

import { redirect } from "next/navigation";
import { getSession, verifyCredentials } from "@/lib/auth";

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const ok = await verifyCredentials(username, password);
  if (!ok) redirect("/admin/login?error=1");
  const session = await getSession();
  session.isAdmin = true;
  await session.save();
  // No admin dashboard — land on the home page; editing happens inline on
  // CollectionView and the admin bar appears at the bottom.
  redirect("/");
}

export async function logoutAction() {
  const session = await getSession();
  session.destroy();
  redirect("/");
}
