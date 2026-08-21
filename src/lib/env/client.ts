/**
 * Browser-visible environment.
 *
 * Next.js inlines NEXT_PUBLIC_* at build time, so these are referenced as
 * full literal property accesses rather than dynamic lookups. Resolved
 * lazily so a missing value surfaces when the client is actually used.
 */
export interface ClientEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export function getClientEnv(): ClientEnv {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy .env.example to .env.local and fill in the values.",
    );
  }

  return { supabaseUrl, supabaseAnonKey };
}
