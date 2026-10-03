import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { findTool, toolDefinitions } from "@/lib/copilot/tools";

// The copilot's tool-use loop.
//
// The SDK ships a tool runner that drives this loop in memory, but it cannot
// span an approval that arrives in a *later HTTP request* — which is exactly
// what a human approval gate is. So the loop is manual and every turn is
// persisted: a pass ends either with an answer or with rows in
// CopilotToolCall waiting on a person, and the next pass resumes from the
// database.
//
// Content blocks are stored and replayed verbatim. Thinking is on by default
// on this model and its blocks must go back to the API unmodified.

const MODEL = "claude-opus-5";
const MAX_TOKENS = 16000;
const MAX_PASSES = 8;

// Thinking is on by default on this model and runs at "high" unless told
// otherwise, which is most of the bill for questions like "how are my
// campaigns doing". Raise this for harder work.
const EFFORT = "medium";

const SYSTEM = `You are the copilot inside an outbound email platform, helping the user run their own workspace.

Use your tools to look things up rather than guessing or asking the user for
facts you can fetch yourself. When a question depends on the workspace's actual
state — campaign results, who replied, what is connected — read it first and
answer from what you find.

Keep responses focused, brief, and concise. Lead with the answer; supporting
detail comes after, and only when it changes what the user would do next. Skip
preamble and do not narrate which tools you are about to call.

Deliver what the user asked for, at the scope they intended. Make routine
judgment calls yourself and check in only when different readings would lead to
materially different work. If you think the ask is mistaken, say so in a
sentence and continue with what they asked for.

Tools that change something or send mail are gated: the user sees the exact
call and approves it before it runs. Propose those deliberately and explain
what one will do in plain terms — never batch a speculative change in with a
read. Never claim you have done something a tool has not returned a result for.

This workspace sends real email to real people. Treat anything that puts mail
in motion — activating a campaign, adding leads to an active one — as
consequential, and say what it will cause before proposing it.`;

function client(): Anthropic {
  // The SDK reads ANTHROPIC_API_KEY itself; the explicit check keeps the
  // failure a clear message rather than an auth error from the first call.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Set ANTHROPIC_API_KEY in .env to use the copilot.");
  }
  return new Anthropic();
}

export function copilotAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

type Blocks = Anthropic.ContentBlockParam[];

// Caching is a prefix match over tools → system → messages, so one breakpoint
// on the system block covers the tool schemas too, and a rolling one on the
// newest turn makes every later pass read the conversation back instead of
// re-paying for it. A thread replays whole — thinking blocks included — so
// without this the tenth question in a thread costs several times the first.
// Breakpoints are added per request rather than stored: only four are allowed,
// and persisted ones would accumulate.
const CACHEABLE = ["text", "image", "document", "tool_use", "tool_result"];

function cached(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const last = messages.at(-1);
  if (!last || typeof last.content === "string") return messages;
  // Thinking blocks can't carry a breakpoint, so mark the newest block that can.
  const at = last.content.findLastIndex((block) => CACHEABLE.includes(block.type));
  if (at < 0) return messages;
  const content = last.content.map((block, index) =>
    index === at ? { ...block, cache_control: { type: "ephemeral" as const } } : block
  );
  return [...messages.slice(0, -1), { ...last, content } as Anthropic.MessageParam];
}

async function history(threadId: string): Promise<Anthropic.MessageParam[]> {
  const rows = await db.copilotMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    role: row.role as "user" | "assistant",
    content: JSON.parse(row.content) as Blocks,
  }));
}

async function record(threadId: string, role: "user" | "assistant", content: Blocks) {
  await db.copilotMessage.create({
    data: { threadId, role, content: JSON.stringify(content) },
  });
}

async function permitted(workspaceId: string, tool: string): Promise<boolean> {
  const permission = await db.toolPermission.findUnique({
    where: { workspaceId_tool: { workspaceId, tool } },
  });
  return Boolean(permission);
}

async function execute(
  workspaceId: string,
  name: string,
  input: Record<string, unknown>
): Promise<{ result: string; isError: boolean }> {
  const tool = findTool(name);
  if (!tool) return { result: `No such tool: ${name}`, isError: true };
  try {
    return { result: await tool.run({ workspaceId }, input), isError: false };
  } catch (err) {
    // Returned as a tool result rather than thrown: the model can read the
    // failure and try something else, which a thrown error would prevent.
    return { result: `Tool failed: ${(err as Error).message}`, isError: true };
  }
}

export type PassResult =
  | { state: "done" }
  | { state: "needs_approval"; pending: number }
  | { state: "error"; message: string };

/**
 * Drive the conversation until the model answers, stops for an approval, or
 * hits the pass ceiling. Safe to call again after an approval is resolved.
 */
export async function runCopilot(threadId: string): Promise<PassResult> {
  const thread = await db.copilotThread.findUniqueOrThrow({ where: { id: threadId } });
  const anthropic = client();

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    // Anything still waiting on a person stops the loop before it spends a
    // request it cannot complete.
    const waiting = await db.copilotToolCall.count({
      where: { threadId, status: "pending" },
    });
    if (waiting > 0) return { state: "needs_approval", pending: waiting };

    // Resolved calls from the previous pass become the next user turn. The API
    // requires one tool_result per tool_use, so they are only sent once every
    // call from that turn has an outcome.
    const resolved = await db.copilotToolCall.findMany({
      where: { threadId, status: { in: ["auto", "approved", "denied"] }, result: { not: null } },
      orderBy: { createdAt: "asc" },
    });
    const messages = await history(threadId);
    const unsent = resolved.filter(
      (call) =>
        !messages.some((message) =>
          (message.content as Blocks).some(
            (block) => block.type === "tool_result" && block.tool_use_id === call.toolUseId
          )
        )
    );
    if (unsent.length > 0) {
      const blocks: Blocks = unsent.map((call) => ({
        type: "tool_result",
        tool_use_id: call.toolUseId,
        content: call.result ?? "",
        ...(call.isError ? { is_error: true } : {}),
      }));
      await record(threadId, "user", blocks);
      messages.push({ role: "user", content: blocks });
    }

    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: EFFORT },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: toolDefinitions(),
        messages: cached(messages),
      });
    } catch (err) {
      return { state: "error", message: (err as Error).message };
    }

    if (response.stop_reason === "refusal") {
      await record(threadId, "assistant", [
        { type: "text", text: "I can't help with that one." },
      ]);
      return { state: "done" };
    }

    // Stored whole: thinking and tool_use blocks have to replay unchanged.
    await record(threadId, "assistant", response.content as unknown as Blocks);

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    if (toolUses.length === 0) return { state: "done" };

    let blocked = 0;
    for (const use of toolUses) {
      const tool = findTool(use.name);
      const input = (use.input ?? {}) as Record<string, unknown>;
      const needsApproval =
        tool?.write === true && !(await permitted(thread.workspaceId, use.name));

      if (needsApproval) {
        await db.copilotToolCall.create({
          data: {
            threadId,
            toolUseId: use.id,
            name: use.name,
            input: JSON.stringify(input),
            status: "pending",
          },
        });
        blocked += 1;
        continue;
      }

      const { result, isError } = await execute(thread.workspaceId, use.name, input);
      await db.copilotToolCall.create({
        data: {
          threadId,
          toolUseId: use.id,
          name: use.name,
          input: JSON.stringify(input),
          status: "auto",
          result,
          isError,
          resolvedAt: new Date(),
        },
      });
    }

    if (blocked > 0) return { state: "needs_approval", pending: blocked };
  }

  await record(threadId, "assistant", [
    {
      type: "text",
      text: "I stopped after several rounds of tool calls without reaching an answer. Ask me again with more detail and I'll try a narrower approach.",
    },
  ]);
  return { state: "done" };
}

/** Resolve one pending call, then continue the loop if nothing else blocks it. */
export async function resolveToolCall(
  workspaceId: string,
  callId: string,
  decision: "approve" | "deny",
  remember: boolean
): Promise<PassResult> {
  const call = await db.copilotToolCall.findFirst({
    where: { id: callId, status: "pending", thread: { workspaceId } },
    include: { thread: true },
  });
  if (!call) return { state: "error", message: "That request is no longer pending." };

  if (decision === "deny") {
    await db.copilotToolCall.update({
      where: { id: call.id },
      data: {
        status: "denied",
        // Phrased for the model: it needs to know the human said no, not that
        // the tool broke, so it proposes something else instead of retrying.
        result: "The user declined this action. Do not retry it; suggest an alternative.",
        resolvedAt: new Date(),
      },
    });
  } else {
    if (remember) {
      await db.toolPermission
        .create({ data: { workspaceId, tool: call.name } })
        .catch(() => {}); // already remembered
    }
    const input = JSON.parse(call.input) as Record<string, unknown>;
    const { result, isError } = await execute(workspaceId, call.name, input);
    await db.copilotToolCall.update({
      where: { id: call.id },
      data: { status: "approved", result, isError, resolvedAt: new Date() },
    });
  }

  return runCopilot(call.threadId);
}
