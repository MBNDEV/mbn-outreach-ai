// Starts the sending engine loop with the server. Good enough for a single
// node; a real deployment moves this to a queue worker (see build plan).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DISABLE_SEND_ENGINE === "1") return;
  const { runSendTick } = await import("@/lib/engine/tick");
  const { runInboxSync } = await import("@/lib/engine/sync");
  const { runWarmupTick } = await import("@/lib/engine/warmup");
  const { runAgentTick } = await import("@/lib/agent/runtime");
  const { runProvisioningTick } = await import("@/lib/marketplace/provision");
  const globalAny = globalThis as unknown as { __engineStarted?: boolean };
  if (globalAny.__engineStarted) return;
  globalAny.__engineStarted = true;
  // Each pass must swallow its own failures: an unhandled rejection from a
  // timer takes the whole server down with it.
  setInterval(() => {
    runSendTick()
      .then(({ sent, errors }) => {
        if (sent || errors) console.log(`[engine] tick: sent=${sent} errors=${errors}`);
      })
      .catch((err: Error) => console.error("[engine] tick failed:", err.message));
  }, 60_000);
  setInterval(() => {
    runInboxSync()
      .then(({ ingested, errors }) => {
        if (ingested || errors)
          console.log(`[sync] inbox: ingested=${ingested} errors=${errors}`);
      })
      .catch((err: Error) => console.error("[sync] inbox failed:", err.message));
  }, 120_000);
  setInterval(() => {
    runWarmupTick()
      .then(({ sent, errors }) => {
        if (sent || errors) console.log(`[warmup] tick: sent=${sent} errors=${errors}`);
      })
      .catch((err: Error) => console.error("[warmup] tick failed:", err.message));
  }, 90_000);
  // Agents run on a slower beat: their work is proposing and escalating, and a
  // five-minute cadence keeps approval queues from filling faster than a human
  // can clear them.
  setInterval(() => {
    runAgentTick()
      .then(({ agents, proposed, escalated, errors }) => {
        if (proposed || escalated || errors)
          console.log(
            `[agent] tick: agents=${agents} proposed=${proposed} escalated=${escalated} errors=${errors}`
          );
      })
      .catch((err: Error) => console.error("[agent] tick failed:", err.message));
  }, 300_000);
  // DNS propagation is measured in minutes to hours, so a slow beat is right.
  setInterval(() => {
    runProvisioningTick()
      .then(({ domains, errors }) => {
        if (errors) console.log(`[marketplace] tick: domains=${domains} errors=${errors}`);
      })
      .catch((err: Error) => console.error("[marketplace] tick failed:", err.message));
  }, 240_000);
  console.log("[engine] send (60s) + sync (120s) + warmup (90s) + agents (5m) + provisioning (4m) started");
}
