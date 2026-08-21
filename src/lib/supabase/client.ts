"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getClientEnv } from "@/lib/env/client";

/**
 * Browser client. Uses the anon key, so every request it makes is
 * governed by row level security.
 */
export function createSupabaseBrowserClient() {
  const env = getClientEnv();
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
