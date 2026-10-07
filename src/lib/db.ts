import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

// Case-insensitive text match. Postgres needs Prisma's `mode` arg for it;
// SQLite matches that way already and rejects the arg — so this is the one
// place to change when the datasource provider changes.
export const icontains = (value: string) => ({ contains: value, mode: "insensitive" as const });
