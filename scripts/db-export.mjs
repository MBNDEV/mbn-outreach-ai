// Dump every row to JSON, parents first, so the set can be replayed into a
// fresh database. Run against the OLD database before switching providers:
//   node scripts/db-export.mjs [outfile]
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

export const ORDER = [
  "User","Workspace","Membership","Invitation","Session","ApiKey","Webhook",
  "EmailAccount","LeadList","Lead","LeadListItem","BlocklistEntry","CreditLedger",
  "Campaign","SequenceStep","Variant","CampaignAccount","CampaignLead",
  "Thread","Message","Opportunity","Unsubscribe",
  "MemoryRecord","Agent","AgentEvent","AgentTask",
  "SavedSearch","VisitorEvent","DeliverabilityTest",
  "CopilotThread","CopilotMessage","CopilotToolCall","ToolPermission",
  "ManagedDomain","ManagedMailbox","MarketplaceOrder",
  "PhoneNumber","SmsMessage","CallLog",
];

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? "../db-export.json";
  const db = new PrismaClient();
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  const inSchema = [...schema.matchAll(/^model (\w+)/gm)].map((m) => m[1]);
  const absent = inSchema.filter((m) => !ORDER.includes(m));
  if (absent.length) console.warn("WARNING — models missing from ORDER:", absent.join(", "));

  const data = {};
  let total = 0;
  for (const M of ORDER) {
    const k = lower(M);
    if (!db[k]) continue;
    const rows = await db[k].findMany();
    if (rows.length) { data[M] = rows; total += rows.length; console.log(`  ${M.padEnd(20)} ${rows.length}`); }
  }
  fs.writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), order: ORDER, data }, null, 2));
  console.log(`\n${total} rows / ${Object.keys(data).length} tables -> ${out}`);

  let missed = 0;
  for (const M of inSchema) { const k = lower(M); if (!db[k]) continue; if (await db[k].count() > 0 && !data[M]) { console.log(`  MISSING ${M}`); missed++; } }
  console.log(missed ? `${missed} table(s) missing — do not migrate yet` : "export verified complete");
  await db.$disconnect();
}
