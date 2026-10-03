import { NextRequest, NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/unsubscribe";

// RFC 8058 one-click: Gmail/Yahoo POST here (no body worth reading) and expect
// a 2xx. GET is a courtesy for clients that follow List-Unsubscribe as a link.

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const ok = await unsubscribeByToken(token);
  return NextResponse.json({ unsubscribed: ok }, { status: ok ? 200 : 404 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  return NextResponse.redirect(new URL(`/u/${token}`, req.url));
}
