"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  sendCopilotMessageAction,
  resolveCopilotCallAction,
  loadCopilotAction,
  newCopilotThreadAction,
  type CopilotState,
} from "@/lib/actions/copilot";
import { IconSparkle } from "@/components/icons";

// Per-module openers: the useful question differs by where the user is
// standing, and a blank box is the hardest thing to start from.
const QUICK_ACTIONS: Array<{ match: string; prompts: string[] }> = [
  {
    match: "/campaigns",
    prompts: ["How are my campaigns performing?", "Which campaign has the best reply rate?"],
  },
  { match: "/unibox", prompts: ["Summarise my unread replies", "Who is worth replying to first?"] },
  { match: "/leads", prompts: ["How many leads am I not yet contacting?"] },
  { match: "/accounts", prompts: ["Is anything wrong with my mailboxes?"] },
  { match: "/crm", prompts: ["What's in my pipeline right now?"] },
  { match: "/agents", prompts: ["What has my agent been doing?"] },
  { match: "/dashboard", prompts: ["Give me a status update on the workspace"] },
];

function promptsFor(pathname: string): string[] {
  return (
    QUICK_ACTIONS.find((entry) => pathname.startsWith(entry.match))?.prompts ?? [
      "Give me a status update on the workspace",
    ]
  );
}

export default function CopilotPanel() {
  const [open, setOpen] = useState(false);
  // Starting a new chat remounts the session, which is the only way to clear
  // the two useActionState results — they still carry the old thread's id and
  // would otherwise win the freshest-source merge inside.
  const [session, setSession] = useState(0);

  if (!open) {
    return (
      // A bare circle was too easy to miss, so the closed state carries its
      // label rather than relying on the icon to explain itself.
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-indigo-600 py-3 pl-4 pr-5 text-sm font-semibold text-white shadow-lg transition hover:bg-indigo-700"
      >
        <IconSparkle className="h-5 w-5" />
        Ask copilot
      </button>
    );
  }

  return (
    <CopilotSession
      key={session}
      fresh={session > 0}
      onNewChat={() => setSession((n) => n + 1)}
      onClose={() => {
        setOpen(false);
        // Reopening should land on the thread they were last in, which by then
        // is the one the new chat created.
        setSession(0);
      }}
    />
  );
}

function CopilotSession({
  fresh,
  onNewChat,
  onClose,
}: {
  fresh: boolean;
  onNewChat: () => void;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const [loaded, setLoaded] = useState<CopilotState | null>(null);
  const [sendState, send, sending] = useActionState(sendCopilotMessageAction, {} as CopilotState);
  const [resolveState, resolve, resolving] = useActionState(
    resolveCopilotCallAction,
    {} as CopilotState
  );
  const formRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The freshest of the three sources wins: a resolved approval supersedes the
  // send that produced it, which supersedes what was loaded on open.
  const state = resolveState.threadId ? resolveState : sendState.threadId ? sendState : loaded;
  const turns = state?.turns ?? [];
  const pending = state?.pending ?? [];
  const error = resolveState.error ?? sendState.error ?? state?.error;
  const configured = state?.configured ?? true;
  const busy = sending || resolving;

  useEffect(() => {
    (fresh ? newCopilotThreadAction() : loadCopilotAction()).then(setLoaded);
  }, [fresh]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns.length, pending.length, busy]);

  return (
    <aside className="fixed bottom-6 right-6 z-40 flex h-[32rem] w-[26rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <IconSparkle className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold">Copilot</h2>
        </div>
        <div className="flex items-center gap-1">
          {turns.length > 0 && (
            <button
              onClick={onNewChat}
              disabled={busy}
              className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-60"
            >
              New chat
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close copilot"
            className="rounded-lg px-2 py-1 text-sm text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {!configured && (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Set <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> in{" "}
            <code className="font-mono text-xs">.env</code> to use the copilot.
          </p>
        )}

        {turns.length === 0 && configured && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              Ask about this workspace — I can read your campaigns, replies, leads and mailboxes,
              and make changes once you approve them.
            </p>
            {promptsFor(pathname).map((prompt) => (
              <button
                key={prompt}
                onClick={() => {
                  const field = formRef.current?.elements.namedItem(
                    "message"
                  ) as HTMLTextAreaElement | null;
                  if (field) field.value = prompt;
                  formRef.current?.requestSubmit();
                }}
                className="block w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-sm transition hover:border-indigo-300 hover:bg-indigo-50/40"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {turns.map((turn) => (
          <div
            key={turn.id}
            className={
              turn.role === "user"
                ? "ml-auto w-fit max-w-[85%] rounded-2xl bg-indigo-600 px-3 py-2 text-sm text-white"
                : "w-fit max-w-[90%] rounded-2xl bg-slate-100 px-3 py-2 text-sm whitespace-pre-wrap text-slate-800"
            }
          >
            {turn.text}
          </div>
        ))}

        {pending.map((call) => (
          <div key={call.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
              Approve this action
            </p>
            <p className="mt-1 text-sm font-medium text-amber-900">{call.name}</p>
            <p className="mt-0.5 text-sm text-amber-800">{call.summary}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <form action={resolve}>
                <input type="hidden" name="callId" value={call.id} />
                <input type="hidden" name="decision" value="approve" />
                <button
                  disabled={busy}
                  className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                >
                  Allow once
                </button>
              </form>
              <form action={resolve}>
                <input type="hidden" name="callId" value={call.id} />
                <input type="hidden" name="decision" value="approve" />
                <input type="hidden" name="remember" value="on" />
                <button
                  disabled={busy}
                  className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-60"
                >
                  Always allow {call.name}
                </button>
              </form>
              <form action={resolve}>
                <input type="hidden" name="callId" value={call.id} />
                <input type="hidden" name="decision" value="deny" />
                <button
                  disabled={busy}
                  className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
                >
                  Decline
                </button>
              </form>
            </div>
          </div>
        ))}

        {busy && <p className="text-sm text-slate-400">Working…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <form
        ref={formRef}
        action={send}
        className="border-t border-slate-100 p-3"
        onSubmit={() => {
          // The textarea is uncontrolled; clear it after the action picks the
          // value up so the box is empty while the turn runs.
          requestAnimationFrame(() => formRef.current?.reset());
        }}
      >
        <input type="hidden" name="threadId" value={state?.threadId ?? ""} />
        <textarea
          name="message"
          rows={2}
          disabled={busy || !configured}
          placeholder="Ask about your campaigns, replies or leads…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
          className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 disabled:bg-slate-50"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-slate-400">Enter to send · Shift+Enter for a new line</span>
          <button
            disabled={busy || !configured}
            className="rounded-xl bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            Send
          </button>
        </div>
      </form>
    </aside>
  );
}
