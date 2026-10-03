"use client";

import { useState } from "react";

export default function SnippetBox({ workspaceId }: { workspaceId: string }) {
  const [copied, setCopied] = useState(false);
  // Built in the browser so the snippet always points at the host serving the
  // app, whatever domain that turns out to be.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const tag = `<script async src="${origin}/api/visitors/snippet?w=${workspaceId}"></script>`;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Install the snippet</h2>
      <p className="mt-1 text-sm text-slate-600">
        Paste this before <code className="font-mono text-xs">&lt;/head&gt;</code> on your site. It
        sets a first-party id in the visitor&rsquo;s own browser — no third-party cookie, and
        addresses are hashed before they are stored.
      </p>
      <div className="mt-3 flex items-start gap-2">
        <code className="flex-1 overflow-x-auto rounded-xl bg-slate-900 px-3 py-2.5 font-mono text-xs text-slate-100">
          {tag}
        </code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(tag).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="shrink-0 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium transition hover:bg-slate-50"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </section>
  );
}
