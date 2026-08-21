import "server-only";
import { cache } from "react";
import { getServerEnv } from "@/lib/env/server";

/**
 * Which sign-in methods this deployment actually offers.
 *
 * Read from the Supabase project rather than from a hand-set flag. A
 * flag can disagree with reality, and when it does the user gets a
 * button that fails for reasons nobody can see. The project knows which
 * providers are configured, so it is asked.
 *
 * An environment variable can still hide a provider that is enabled
 * upstream, but it can never show one that is not.
 */
export interface AuthMethods {
  password: boolean;
  google: boolean;
  phone: boolean;
}

const FALLBACK: AuthMethods = { password: true, google: false, phone: false };

interface AuthSettings {
  external?: Record<string, boolean>;
}

export const getAuthMethods = cache(async (): Promise<AuthMethods> => {
  let settings: AuthSettings | null = null;

  try {
    const env = getServerEnv();
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      // Providers change rarely; re-check every few minutes rather than
      // on every render of the sign-in page.
      next: { revalidate: 300 },
    });
    if (res.ok) settings = (await res.json()) as AuthSettings;
  } catch (error) {
    // A sign-in page that cannot reach the auth server should still
    // render, offering the method that needs no provider configuration.
    console.error("[auth] could not read provider settings", error);
  }

  if (!settings) return FALLBACK;

  const external = settings.external ?? {};
  const hidden = (name: string) =>
    process.env[`NEXT_PUBLIC_AUTH_HIDE_${name}`] === "true";

  return {
    password: external.email !== false && !hidden("EMAIL"),
    google: external.google === true && !hidden("GOOGLE"),
    phone: external.phone === true && !hidden("PHONE"),
  };
});
