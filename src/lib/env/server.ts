import "server-only";
import { z } from "zod";

/**
 * Server-side environment.
 *
 * Validated lazily rather than at module load: `next build` evaluates
 * modules during prerender, and a build machine legitimately has no
 * Supabase credentials. Failing at build time would make CI depend on
 * production secrets. Instead the first request that needs a value fails
 * with a precise message.
 */
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url("NEXT_PUBLIC_SUPABASE_URL must be a URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  /**
   * Bypasses row level security completely: every tenant boundary,
   * driver restriction and category scope is void for whatever holds it.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = schema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(
      `Supabase environment is not configured.\n${issues.join("\n")}\n\n` +
        `Copy .env.example to .env.local and fill in the values from ` +
        `Project Settings -> API in your Supabase project.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** True when the app has enough configuration to reach the database. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * The service role key, asserted at the point of use. Never import this
 * into anything reachable from a client component.
 */
export function requireServiceRoleKey(): string {
  const key = getServerEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. This operation requires it. " +
        "Set it in the server environment only - never expose it to the browser.",
    );
  }
  return key;
}
