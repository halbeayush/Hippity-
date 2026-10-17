import { createHash, randomBytes } from "crypto";

// "Sign in with Google" via Google's OAuth 2.0 authorization-code flow, with
// PKCE. Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from a Google Cloud
// OAuth client whose authorized redirect URI is
// <origin>/api/auth/google/callback.
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

// Holds the state + PKCE verifier between the redirect to Google and the
// callback — httpOnly and short-lived.
export const GOOGLE_STATE_COOKIE = "spinsheet_google_oauth";
export const GOOGLE_STATE_MAX_AGE_S = 10 * 60;

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function redirectUri(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

// The URL to send the browser to, plus the cookie value the callback checks
// it against: `state` stops a forged callback (CSRF), and the PKCE verifier
// means an intercepted authorization code is useless on its own.
export function startGoogleSignIn(clientId: string, origin: string) {
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri(origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return { url, cookieValue: `${state}.${verifier}` };
}

// Exchanges the callback's code for the signed-in Google account. Throws on
// any failure.
export async function finishGoogleSignIn(input: {
  code: string;
  verifier: string;
  origin: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ googleId: string; email?: string; name?: string }> {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: redirectUri(input.origin),
      grant_type: "authorization_code",
      code_verifier: input.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const tokens: { access_token?: string; error?: string } =
    await tokenResponse.json();
  if (!tokenResponse.ok || !tokens.access_token) {
    throw new Error(`Google token exchange failed: ${tokens.error ?? tokenResponse.status}`);
  }

  // Fetched straight from Google over HTTPS with the access token just
  // issued, so the profile can be trusted as-is.
  const profileResponse = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const profile: {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  } = await profileResponse.json();
  if (!profileResponse.ok || !profile.sub) {
    throw new Error("Google profile lookup failed");
  }
  return {
    googleId: profile.sub,
    email: profile.email_verified ? profile.email : undefined,
    name: profile.name,
  };
}
