import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";

// GET /api/auth/me — who's signed in, for the nav bar. Only the fields the
// UI shows; never the password hash or Google id.
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return NextResponse.json({
    user: {
      username: user.username,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
    },
  });
}
