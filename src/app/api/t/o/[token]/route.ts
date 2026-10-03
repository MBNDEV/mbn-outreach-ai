import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const message = await db.message.findUnique({ where: { trackingToken: token } });
  if (message) {
    await db.message.update({
      where: { id: message.id },
      data: {
        openCount: { increment: 1 },
        openedAt: message.openedAt ?? new Date(),
      },
    });
  }
  return new NextResponse(PIXEL as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
