# Outreach Platform (phases 1–6)

Instantly.ai-style outbound platform — see `../infra-llm/plans/instantly-build-plan.md`
for the full roadmap. Phase 1: auth, workspaces, plans, mailbox connect +
credential vault + health checks. Phase 2: campaigns + sending engine.
Phase 3: Unibox (inbox sync, reply/bounce/OOO detection, threads, labels,
reply composer) + API keys + webhooks. Phase 4: workspace leads database,
lists, credit ledger, email-verification waterfall, blocklist. Phase 5: AI
layer (Claude sequence generation + reply classification, env-gated).
Phase 6: CRM opportunities kanban fed from Unibox labels.

## Run

```bash
cd web
npm install
npx prisma db push   # creates prisma/dev.db (SQLite)
npm run dev          # http://localhost:3000
```

`.env` needs `DATABASE_URL`, `APP_URL`, and a 32-byte `APP_ENCRYPTION_KEY`
(see `.env.example`). To enable Gmail/Microsoft OAuth connections, register an
OAuth app with each provider and fill `GOOGLE_CLIENT_ID/SECRET` and
`MICROSOFT_CLIENT_ID/SECRET`; the redirect URIs are
`{APP_URL}/api/oauth/google/callback` and `{APP_URL}/api/oauth/microsoft/callback`.

## What's here

- Signup/login (bcrypt + DB-backed session cookie), invitation links with
  role-based membership (owner/admin/member).
- Workspace with plan limits (`src/lib/plans.ts`) enforced on accounts and
  members.
- Email accounts: SMTP/IMAP single connect, bulk CSV import, Google/Microsoft
  OAuth (env-gated). Credentials AES-256-GCM encrypted (`src/lib/vault.ts`).
- Health checks: SMTP `verify` + IMAP login for password accounts, refresh-
  token probe for OAuth accounts; status/error surfaced in the accounts table
  with re-check and remove actions, search + status/tag filters.

## Phase 2 — campaigns & sending

- Campaign list + 4-tab campaign shell (Analytics / Editor / Leads /
  Settings) with inline rename, status pill, Launch/Pause with pre-launch
  validation (needs copy + accounts + leads).
- Sequence editor: multi-step with wait-days, A/B/…E variants per step,
  `{{first_name|fallback}}` variables and `{{RANDOM|a|b}}` spintax
  (`src/lib/template.ts`), variable-insert chips, live preview with a sample
  lead.
- Leads: CSV import (extra columns become custom variables) and paste-emails;
  per-lead sequence state (`CampaignLead`).
- Settings: sending-account rotation, send days/window/timezone, campaign
  daily limit, gap + jitter, open/click tracking, stop-on-reply (wired for
  phase 3), unsubscribe footer + RFC 8058 one-click headers.
- Sending engine (`src/lib/engine/tick.ts`), started by
  `src/instrumentation.ts` on a 60s interval (`DISABLE_SEND_ENGINE=1` to turn
  off): honors window/limits/gaps, rotates accounts, renders templates,
  injects tracking pixel + rewritten links, advances or completes the
  sequence, respects the workspace unsubscribe list.
- Tracking endpoints: `/api/t/o/[token]` (open pixel), `/api/t/c/[token]`
  (click redirect), `/u/[token]` (unsubscribe page).
- Analytics: campaign KPIs + per-step, per-variant sent/opened/clicks.

## Phases 3–6 — unibox, data, AI, CRM

- **Inbox sync** (`src/lib/engine/sync.ts`, every 2 min + "Sync now"): IMAP
  UID-cursor polling per connected mailbox (XOAUTH2 for Google/Microsoft),
  mailparser ingestion, dedupe by Message-ID, correlation via
  In-Reply-To/References then sender address. Classification: bounce
  (mailer-daemon/subject/multipart-report), auto-reply (Auto-Submitted/
  Precedence/subject), else reply. Consequences: bounce → lead `bounced`;
  reply → `replied` + sequence stop (honors `stopOnReply`); OOO → next send
  pushed +3 days, thread labeled `out_of_office`.
- **Unibox** (`/unibox`): label pipeline chips with counts, Open/Unread/
  Reminders/Done views, search, thread pane with chat-style bubbles, label
  picker, reminder datetime, done toggle, threaded reply composer
  (In-Reply-To headers, sends from the thread's mailbox).
- **API** (`/api/v1/campaigns`, `/api/v1/leads` GET/POST): bearer API keys
  (SHA-256 stored, shown once), per-workspace. **Webhooks**: reply_received,
  bounce_received, lead_unsubscribed, campaign_completed; HMAC-SHA256
  signed, fire-and-forget.
- **Leads** (`/leads`): workspace-wide database, lists, CSV import (extra
  columns → custom variables), search, bulk verify + push-to-campaign.
  **Credits**: 1,000 to start, atomic ledger (`src/lib/credits.ts`).
  **Verification waterfall** (`src/lib/enrichment.ts`): Hunter (if
  HUNTER_API_KEY) → syntax+MX check; 1 credit per lead.
  **Blocklist** (settings): emails/domains the engine refuses to contact.
- **AI** (`src/lib/ai.ts`, needs ANTHROPIC_API_KEY): "Generate with AI" in
  the sequence editor (claude-sonnet-5, guardrail against fabricated stats)
  and automatic reply labeling in sync (claude-haiku). Both degrade
  gracefully when unset.
- **CRM** (`/crm`): opportunities kanban (Interested → Meeting booked →
  Meeting completed → Won), auto-created when a thread is labeled a positive
  stage, inline value/stage edits, weighted pipeline totals.

## Notes

- SQLite is dev-only; switch `prisma/schema.prisma` datasource to
  `postgresql` before staging (schema is already portable).
- Phase 2 (campaigns + sending engine) builds on `EmailAccount.credentials`
  and the plan-limit middleware here.
