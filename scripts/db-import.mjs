// Replay a db-export.json into the CURRENT database (the new Postgres one).
//   node scripts/db-import.mjs ../db-export.json [--wipe]
//
// APP_ENCRYPTION_KEY must match the environment the export came from, or the
// EmailAccount credential blobs (including the Gmail refresh token) will not
// decrypt and the mailbox will fail with no obvious cause.
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { ORDER } from "./db-export.mjs";

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
// JSON has no date type; Prisma wants Date objects (or ISO strings) — convert
// explicitly so a string never lands in a DateTime column.
const revive = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" && ISO.test(v) ? new Date(v) : v]));

const file = process.argv[2] ?? "../db-export.json";
const wipe = process.argv.includes("--wipe");
const db = new PrismaClient();
const { data, exportedAt } = JSON.parse(fs.readFileSync(file, "utf8"));
console.log(`importing export from ${exportedAt}`);

if (wipe) {
  console.log("wiping target (children first)...");
  for (const M of [...ORDER].reverse()) { const k = lower(M); if (db[k]) await db[k].deleteMany({}); }
}

let total = 0, failed = 0;
for (const M of ORDER) {
  const rows = data[M];
  if (!rows?.length) continue;
  const k = lower(M);
  if (!db[k]) { console.log(`  ${M}: no delegate, skipped`); continue; }
  let ok = 0;
  for (const row of rows) {
    try { await db[k].create({ data: revive(row) }); ok++; }
    catch (e) {
      // a duplicate is fine on a re-run; anything else is a real problem
      if (/Unique constraint/.test(e.message)) ok++;
      else { failed++; console.log(`  ${M} row failed: ${e.message.split("\n").slice(-2).join(" ").slice(0, 140)}`); }
    }
  }
  total += ok;
  console.log(`  ${M.padEnd(20)} ${ok}/${rows.length}`);
}
console.log(`\n${total} rows imported${failed ? `, ${failed} failed` : ""}`);
if (!failed) console.log("import clean — verify login and the mailbox next");
await db.$disconnect();
