"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace, requireRole } from "@/lib/auth";
import { isMemoryKind } from "@/lib/agent/memory";
import { queueLead, runAgentOnce } from "@/lib/agent/runtime";
import type { FormState } from "@/lib/actions/auth";

async function ownedAgent(id: string) {
  const { workspace, role } = await requireWorkspace();
  const agent = await db.agent.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!agent) throw new Error("Agent not found.");
  return { agent, workspace, role };
}

export async function createAgentAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const name = String(formData.get("name") ?? "").trim() || "Sales agent";
  const agent = await db.agent.create({
    data: { workspaceId: workspace.id, name },
  });
  await db.agentEvent.create({
    data: { agentId: agent.id, kind: "status", message: "Agent created, paused." },
  });
  redirect(`/agents/${agent.id}`);
}

export async function setAgentStatusAction(formData: FormData): Promise<void> {
  const { agent } = await ownedAgent(String(formData.get("id") ?? ""));
  await requireRole("admin");
  const status = agent.status === "active" ? "paused" : "active";
  await db.agent.update({ where: { id: agent.id }, data: { status } });
  await db.agentEvent.create({
    data: {
      agentId: agent.id,
      kind: "status",
      message: status === "active" ? "Resumed by a human." : "Paused by a human.",
    },
  });
  revalidatePath(`/agents/${agent.id}`);
  revalidatePath("/agents");
}

export async function saveAgentAction(formData: FormData): Promise<void> {
  const { agent } = await ownedAgent(String(formData.get("id") ?? ""));
  await requireRole("admin");
  const target = Number(formData.get("dailyLeadTarget") ?? agent.dailyLeadTarget);
  await db.agent.update({
    where: { id: agent.id },
    data: {
      name: String(formData.get("name") ?? agent.name).trim() || agent.name,
      icp: String(formData.get("icp") ?? "").trim().slice(0, 1000),
      dailyLeadTarget: Math.max(1, Math.min(200, Math.round(target) || agent.dailyLeadTarget)),
      autoApprove: formData.get("autoApprove") === "on",
    },
  });
  revalidatePath(`/agents/${agent.id}`);
}

export async function deleteAgentAction(formData: FormData): Promise<void> {
  const { agent } = await ownedAgent(String(formData.get("id") ?? ""));
  await requireRole("admin");
  // The campaign it built outlives it: those leads were mailed, and the history
  // belongs to the workspace rather than to the agent.
  await db.agent.delete({ where: { id: agent.id } });
  revalidatePath("/agents");
  redirect("/agents");
}

export async function runAgentNowAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const { agent } = await ownedAgent(String(formData.get("id") ?? ""));
    const result = await runAgentOnce(agent.id);
    revalidatePath(`/agents/${agent.id}`);
    if (result.proposed === 0 && result.escalated === 0) {
      return { error: "Nothing new to do — the feed says why." };
    }
    return {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function resolveTaskAction(formData: FormData): Promise<void> {
  const { workspace } = await requireWorkspace();
  const id = String(formData.get("taskId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const task = await db.agentTask.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { agent: true, lead: true },
  });
  if (!task || task.status !== "pending") return;

  if (task.type === "lead_approval" && decision === "approve" && task.leadId) {
    await db.agentTask.update({
      where: { id: task.id },
      data: { status: "approved", resolvedAt: new Date() },
    });
    await queueLead(task.agent, task.leadId);
    await db.agentEvent.create({
      data: {
        agentId: task.agentId,
        kind: "approved",
        message: `${task.lead?.email ?? "Lead"} approved and queued.`,
      },
    });
  } else if (decision === "approve") {
    // A reply escalation is acknowledged rather than queued: the human replies
    // in the Unibox, the agent only needed to stop and hand it over.
    await db.agentTask.update({
      where: { id: task.id },
      data: { status: "done", resolvedAt: new Date() },
    });
  } else {
    await db.agentTask.update({
      where: { id: task.id },
      data: { status: "rejected", resolvedAt: new Date() },
    });
    await db.agentEvent.create({
      data: {
        agentId: task.agentId,
        kind: "rejected",
        message: `${task.lead?.email ?? "Task"} rejected — I won't propose it again.`,
      },
    });
  }
  revalidatePath(`/agents/${task.agentId}`);
}

// ---- Workspace memory -------------------------------------------------------

export async function addMemoryAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const kind = String(formData.get("kind") ?? "");
  const content = String(formData.get("content") ?? "").trim();
  if (!content || !isMemoryKind(kind)) return;
  await db.memoryRecord.create({
    data: { workspaceId: workspace.id, kind, content: content.slice(0, 2000) },
  });
  revalidatePath("/agents", "layout");
  revalidatePath("/business");
}

export async function toggleMemoryAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  const record = await db.memoryRecord.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!record) return;
  await db.memoryRecord.update({
    where: { id: record.id },
    data: { enabled: !record.enabled },
  });
  revalidatePath("/agents", "layout");
  revalidatePath("/business");
}

export async function deleteMemoryAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  await db.memoryRecord.deleteMany({
    where: { id: String(formData.get("id") ?? ""), workspaceId: workspace.id },
  });
  revalidatePath("/agents", "layout");
  revalidatePath("/business");
}
