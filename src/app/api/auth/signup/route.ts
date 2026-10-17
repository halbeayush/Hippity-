import { NextRequest, NextResponse } from "next/server";
import { signUpWithPassword } from "@/lib/auth";
import { createSession } from "@/lib/session";

// POST /api/auth/signup { username, password, displayName? } — creates a
// username + password account and signs it in.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const result = await signUpWithPassword({
    username: String(body?.username ?? ""),
    password: String(body?.password ?? ""),
    displayName: body?.displayName ? String(body.displayName) : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  await createSession(result.user.id);
  return NextResponse.json({ ok: true });
}
