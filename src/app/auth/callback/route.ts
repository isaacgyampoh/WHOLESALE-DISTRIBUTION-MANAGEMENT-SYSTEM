import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * OAuth return leg.
 *
 * Supabase sends the browser here with a one-time code, which is
 * exchanged for a session and written to cookies by the server client.
 *
 * An account that has never been invited arrives here perfectly valid
 * and still reaches nothing: migration 0017 creates it inactive, and the
 * application shell shows it the pending screen.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");

  // Only same-origin paths, so the redirect cannot be pointed off site.
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!code) {
    const back = new URL("/sign-in", url.origin);
    back.searchParams.set("error", "missing_code");
    return NextResponse.redirect(back);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth] oauth code exchange failed", error);
    const back = new URL("/sign-in", url.origin);
    back.searchParams.set("error", "exchange_failed");
    return NextResponse.redirect(back);
  }

  return NextResponse.redirect(new URL(target, url.origin));
}
