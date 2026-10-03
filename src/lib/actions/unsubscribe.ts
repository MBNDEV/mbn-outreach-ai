"use server";

import { redirect } from "next/navigation";
import { unsubscribeByToken } from "@/lib/unsubscribe";

export async function confirmUnsubscribeAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  await unsubscribeByToken(token);
  redirect(`/u/${token}?done=1`);
}
