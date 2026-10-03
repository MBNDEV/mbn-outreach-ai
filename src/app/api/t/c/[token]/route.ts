import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clickSignatureValid } from "@/lib/tracking";
import { withVisitToken } from "@/lib/visitors";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const query = new URL(req.url).searchParams;
  const url = query.get("u");
  const signature = query.get("s") ?? "";
  if (!url || !/^https?:\/\//.test(url) || !clickSignatureValid(token, url, signature)) {
    return NextResponse.json({ error: "Bad link" }, { status: 400 });
  }
  const message = await db.message.findUnique({
    where: { trackingToken: token },
    select: { id: true },
  });
  if (message) {
    await db.message.update({
      where: { id: message.id },
      data: { clickCount: { increment: 1 } },
    });
  }
  // Carry the token into the destination so the visitor snippet can attribute
  // this session — and every later visit from the browser — to this lead.
  return NextResponse.redirect(withVisitToken(url, token));
}
