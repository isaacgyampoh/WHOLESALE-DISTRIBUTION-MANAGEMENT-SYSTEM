import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getServerEnv, requireServiceRoleKey } from "@/lib/env/server";

/**
 * Request-scoped Supabase client carrying the caller's session.
 *
 * Every query made through this client is subject to row level security,
 * which is what enforces tenant isolation, driver restrictions and
 * manager category scopes. This is the client almost everything uses.
 */
export async function createSupabaseServerClient() {
  // cookies() first: it marks the request dynamic. Reading env before it
  // would let a config error surface during static prerender instead.
  const cookieStore = await cookies();
  const env = getServerEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Session refresh is handled by middleware instead.
          }
        },
      },
    },
  );
}

/**
 * Administrative client that BYPASSES ROW LEVEL SECURITY ENTIRELY.
 *
 * With this client there is no tenant boundary, no driver restriction and
 * no category scope: it can read and write every organization's data.
 * Use it only where a request genuinely cannot run as the caller, and
 * perform the authorization check yourself, in code, first.
 *
 * Never import this into a client component.
 */
export function createSupabaseAdminClient() {
  return createClient(getServerEnv().NEXT_PUBLIC_SUPABASE_URL, requireServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
