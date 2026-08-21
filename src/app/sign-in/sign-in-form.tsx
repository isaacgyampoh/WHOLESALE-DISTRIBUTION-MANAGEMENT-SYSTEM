"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { authMethods } from "@/lib/auth/providers";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { cn } from "@/lib/utils/cn";
import { Eye, EyeOff } from "lucide-react";

type Method = "email" | "phone";

/** Same wording for every failure, so accounts cannot be enumerated. */
const CREDENTIALS_REJECTED = "That sign-in was not recognised. Check the details and try again.";

export function SignInForm({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const methods = authMethods();

  const [method, setMethod] = useState<Method>("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<null | "password" | "google">(null);

  /** Only same-origin paths, so ?next= cannot redirect off site. */
  const safeNext = nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading("password");

    try {
      const supabase = createSupabaseBrowserClient();
      const credentials =
        method === "phone"
          ? { phone: phone.trim(), password }
          : { email: email.trim(), password };

      const { error: signInError } = await supabase.auth.signInWithPassword(credentials);
      if (signInError) {
        setError(CREDENTIALS_REJECTED);
        return;
      }

      router.replace(safeNext);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(null);
    }
  }

  async function onGoogle() {
    setError(null);
    setLoading("google");
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (oauthError) {
        setError("Google sign-in is unavailable right now.");
        setLoading(null);
      }
      // On success the browser leaves for Google; nothing more to do.
    } catch {
      setError("Could not start Google sign-in.");
      setLoading(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="danger">{error}</Alert>}

      {methods.phone && (
        <div
          role="tablist"
          aria-label="Sign-in method"
          className="grid grid-cols-2 gap-1 rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] p-1"
        >
          {(["email", "phone"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              type="button"
              aria-selected={method === m}
              onClick={() => { setMethod(m); setError(null); }}
              className={cn(
                "min-h-11 rounded-md text-sm font-medium transition-colors",
                method === m
                  ? "bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-secondary)]",
              )}
            >
              {m === "email" ? "Email" : "Phone"}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        {method === "email" ? (
          <Field label="Email" htmlFor="email" required>
            <Input
              id="email" name="email" type="email" autoComplete="username"
              required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </Field>
        ) : (
          <Field
            label="Phone number"
            htmlFor="phone"
            required
            hint="Include the country code, for example +233 24 111 0000"
          >
            <Input
              id="phone" name="phone" type="tel" autoComplete="tel"
              inputMode="tel" required value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+233241110000"
            />
          </Field>
        )}

        <Field label="Password" htmlFor="password" required>
          <div className="relative">
            <Input
              id="password" name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 grid w-12 place-items-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>

        <Button type="submit" size="lg" loading={loading === "password"} className="w-full">
          Sign in
        </Button>
      </form>

      {methods.google && (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-[var(--border-subtle)]" />
            <span className="text-xs text-[var(--text-muted)]">or</span>
            <span className="h-px flex-1 bg-[var(--border-subtle)]" />
          </div>

          <Button
            type="button" variant="outline" size="lg" className="w-full"
            loading={loading === "google"} onClick={onGoogle}
          >
            {loading !== "google" && <GoogleMark />}
            Continue with Google
          </Button>
        </>
      )}
    </div>
  );
}

/** Google's mark, inline so the page pulls nothing from another host. */
function GoogleMark() {
  return (
    <svg className="size-4" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}
