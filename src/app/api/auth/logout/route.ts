import { NextResponse } from "next/server";
import { destroySession } from "@/lib/session";

// POST /api/auth/logout — ends this browser's session.
export async function POST() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
