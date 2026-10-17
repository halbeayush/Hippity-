"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

type Mode = "login" | "signup";

// Messages for the ?error= the Google routes redirect back with.
const GOOGLE_ERRORS: Record<string, string> = {
  google: "Google sign-in didn't go through. Try again.",
  "google-not-configured":
    "Google sign-in isn't set up on this server yet — use a username and password for now.",
};

// Only same-site paths, so ?next= can't send someone off to another site
// after they sign in.
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(
    GOOGLE_ERRORS[searchParams.get("error") ?? ""] ?? null,
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "signup"
            ? { username, password, displayName }
            : { username, password },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        setSubmitting(false);
        return;
      }
      // A full page load rather than a client-side navigation, so
      // everything mounted once in the root layout (the floating library
      // covers) loads for the account that just signed in.
      window.location.assign(safeNext(searchParams.get("next")));
    } catch {
      setError("Couldn't reach the server. Try again.");
      setSubmitting(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500";

  return (
    <div className="w-full max-w-sm rounded-2xl bg-white/95 p-6 shadow-xl backdrop-blur dark:bg-zinc-900/95">
      <h1 className="mb-1 text-center text-xl font-bold">Spinsheet</h1>
      <p className="mb-5 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {mode === "login" ? "Log in to your music diary" : "Create your account"}
      </p>

      <div className="mb-5 flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm font-medium dark:bg-zinc-800">
        {(["login", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            aria-pressed={mode === m}
            className={`flex-1 rounded-md py-1.5 ${
              mode === m
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {m === "login" ? "Log in" : "Sign up"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Username
          <input
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </label>
        {mode === "signup" && (
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Display name <span className="font-normal text-zinc-400">(optional)</span>
            <input
              className={inputClass}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="nickname"
              maxLength={40}
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Password
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "signup" ? 8 : undefined}
            required
          />
        </label>
        {mode === "signup" && (
          <p className="text-[11px] text-zinc-400">
            Usernames are 3-20 lowercase letters, numbers or underscores.
            Passwords need at least 8 characters.
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {submitting ? "One moment..." : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>

      <div className="my-4 flex items-center gap-3 text-[11px] text-zinc-400">
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
        or
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
      </div>

      {/* A plain link, not fetch: Google's sign-in is a full-page redirect. */}
      <a
        href="/api/auth/google"
        className="flex items-center justify-center gap-2 rounded-lg border border-zinc-200 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h6a5.1 5.1 0 0 1-2.2 3.4v2.8h3.6c2.1-1.9 3.2-4.8 3.2-8.2Z" />
          <path fill="#34A853" d="M12 23c3 0 5.5-1 7.4-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2v2.9A11 11 0 0 0 12 23Z" />
          <path fill="#FBBC05" d="M5.7 14a6.6 6.6 0 0 1 0-4.2V7H2a11 11 0 0 0 0 9.9L5.7 14Z" />
          <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.3 1.7l3.2-3.2A11 11 0 0 0 2 7l3.7 2.9C6.6 7.3 9.1 5.4 12 5.4Z" />
        </svg>
        Continue with Google
      </a>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      {/* useSearchParams needs a Suspense boundary on a client page. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
