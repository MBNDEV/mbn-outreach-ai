import "server-only";
import { db } from "@/lib/db";

const STAGE_LABELS = new Set(["interested", "meeting_booked", "meeting_completed", "won"]);

/** Threads entering a positive pipeline label materialize as opportunities;
 *  later label changes advance the stage rather than duplicating. */
export async function syncOpportunityFromThread(threadId: string): Promise<void> {
  const thread = await db.thread.findUnique({ where: { id: threadId } });
  if (!thread) return;
  const existing = await db.opportunity.findUnique({ where: { threadId } });

  if (!STAGE_LABELS.has(thread.label)) {
    if (existing && ["not_interested", "lost"].includes(thread.label)) {
      await db.opportunity.update({ where: { id: existing.id }, data: { stage: "lost" } });
    }
    return;
  }
  if (existing) {
    await db.opportunity.update({
      where: { id: existing.id },
      data: { stage: thread.label },
    });
  } else {
    await db.opportunity.create({
      data: {
        workspaceId: thread.workspaceId,
        threadId,
        contactEmail: thread.contactEmail,
        name: thread.contactEmail.split("@")[1] ?? thread.contactEmail,
        stage: thread.label,
      },
    });
  }
}
