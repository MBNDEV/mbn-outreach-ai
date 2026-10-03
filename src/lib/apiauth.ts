import "server-only";
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export async function workspaceFromApiKey(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key) return null;
  const record = await db.apiKey.findUnique({ where: { keyHash: hashApiKey(key) } });
  if (!record) return null;
  db.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return db.workspace.findUnique({ where: { id: record.workspaceId } });
}

export function unauthorized() {
  return NextResponse.json(
    { error: "Provide a valid API key: Authorization: Bearer <key>" },
    { status: 401 }
  );
}
