"use server";

import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { runCopilot, resolveToolCall, copilotAvailable } from "@/lib/copilot/runtime";
import { findTool } from "@/lib/copilot/tools";

export interface CopilotTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface PendingCall {
  id: string;
  name: string;
  summary: string;
  input: Record<string, unknown>;
}

export interface CopilotState {
  error?: string;
  threadId?: string;
  turns?: CopilotTurn[];
  pending?: PendingCall[];
  configured?: boolean;
}

/** One plain-language line describing what a pending call would do. */
function summarize(name: string, input: Record<string, unknown>): string {
  const tool = findTool(name);
  const args = Object.entries(input)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join(" · ");
  return [tool?.description.split(".")[0] ?? name, args].filter(Boolean).join(" — ");
}

async function snapshot(workspaceId: string, threadId: string): Promise<CopilotState> {
  const [messages, pending] = await Promise.all([
    db.copilotMessage.findMany({ where: { threadId }, orderBy: { createdAt: "asc" } }),
    db.copilotToolCall.findMany({
      where: { threadId, status: "pending" },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Only the visible text reaches the UI; thinking, tool_use and tool_result
  // blocks stay server-side where the loop replays them.
  const turns: CopilotTurn[] = [];
  for (const message of messages) {
    let blocks: Array<{ type: string; text?: string }> = [];
    try {
      blocks = JSON.parse(message.content);
    } catch {}
    const text = blocks
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n\n")
      .trim();
    if (text) {
      turns.push({ id: message.id, role: message.role as "user" | "assistant", text });
    }
  }

  return {
    threadId,
    turns,
    configured: copilotAvailable(),
    pending: pending.map((call) => {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(call.input);
      } catch {}
      return { id: call.id, name: call.name, summary: summarize(call.name, input), input };
    }),
  };
}

/** Most recent thread for this user, or a fresh one. */
export async function loadCopilotAction(): Promise<CopilotState> {
  const { workspace, user } = await requireWorkspace();
  const thread = await db.copilotThread.findFirst({
    where: { workspaceId: workspace.id, userId: user.id },
    orderBy: { updatedAt: "desc" },
  });
  if (!thread) return { configured: copilotAvailable(), turns: [], pending: [] };
  return snapshot(workspace.id, thread.id);
}

export async function sendCopilotMessageAction(
  _prev: CopilotState,
  formData: FormData
): Promise<CopilotState> {
  try {
    const { workspace, user } = await requireWorkspace();
    if (!copilotAvailable()) {
      return { configured: false, error: "Set ANTHROPIC_API_KEY in .env to use the copilot." };
    }
    const text = String(formData.get("message") ?? "").trim();
    if (!text) return { error: "Type a message first." };

    const existing = String(formData.get("threadId") ?? "");
    const thread = existing
      ? await db.copilotThread.findFirst({
          where: { id: existing, workspaceId: workspace.id, userId: user.id },
        })
      : null;
    const active =
      thread ??
      (await db.copilotThread.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          title: text.slice(0, 60),
        },
      }));

    await db.copilotMessage.create({
      data: {
        threadId: active.id,
        role: "user",
        content: JSON.stringify([{ type: "text", text }]),
      },
    });
    await db.copilotThread.update({ where: { id: active.id }, data: { updatedAt: new Date() } });

    const result = await runCopilot(active.id);
    const state = await snapshot(workspace.id, active.id);
    return result.state === "error" ? { ...state, error: result.message } : state;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function resolveCopilotCallAction(
  _prev: CopilotState,
  formData: FormData
): Promise<CopilotState> {
  try {
    const { workspace } = await requireWorkspace();
    const callId = String(formData.get("callId") ?? "");
    const decision = String(formData.get("decision") ?? "") === "approve" ? "approve" : "deny";
    const remember = formData.get("remember") === "on";

    const result = await resolveToolCall(workspace.id, callId, decision, remember);
    const call = await db.copilotToolCall.findFirst({
      where: { id: callId, thread: { workspaceId: workspace.id } },
      select: { threadId: true },
    });
    if (!call) return { error: "That request is gone." };

    const state = await snapshot(workspace.id, call.threadId);
    return result.state === "error" ? { ...state, error: result.message } : state;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function newCopilotThreadAction(): Promise<CopilotState> {
  await requireWorkspace();
  return { turns: [], pending: [], configured: copilotAvailable() };
}

/** Tools this workspace has chosen to stop being asked about. */
export async function listToolPermissionsAction(): Promise<string[]> {
  const { workspace } = await requireWorkspace();
  const rows = await db.toolPermission.findMany({ where: { workspaceId: workspace.id } });
  return rows.map((row) => row.tool);
}

export async function revokeToolPermissionAction(formData: FormData): Promise<void> {
  const { workspace } = await requireWorkspace();
  await db.toolPermission.deleteMany({
    where: { workspaceId: workspace.id, tool: String(formData.get("tool") ?? "") },
  });
}
