import { NextRequest, NextResponse } from "next/server";
import { logInWithPassword } from "@/lib/auth";
import { createSession } from "@/lib/session";

// POST /api/auth/login { username, password } — signs in a username +
// password account.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const result = await logInWithPassword({
    username: String(body?.username ?? ""),
    password: String(body?.password ?? ""),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }
  await createSession(result.user.id);
  return NextResponse.json({ ok: true });
}
