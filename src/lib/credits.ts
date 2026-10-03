import "server-only";
import { db } from "@/lib/db";

/** Atomically spend credits; throws if the balance is insufficient. */
export async function spendCredits(
  workspaceId: string,
  amount: number,
  reason: string
): Promise<void> {
  if (amount <= 0) return;
  await db.$transaction(async (tx) => {
    const updated = await tx.workspace.updateMany({
      where: { id: workspaceId, credits: { gte: amount } },
      data: { credits: { decrement: amount } },
    });
    if (updated.count === 0) {
      throw new Error("Not enough credits. Top up to continue.");
    }
    await tx.creditLedger.create({
      data: { workspaceId, delta: -amount, reason },
    });
  });
}
