"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Keeps the rendered page honest about who is signed in.
 *
 * Server components resolve the user once per request. Without this, a
 * session that expires, or a sign-out in another tab, would leave a
 * stale shell on screen until the next navigation - showing a name and
 * a menu belonging to someone who is no longer signed in.
 *
 * Nothing here is a security control: the server re-resolves identity on
 * every request and the database enforces access regardless.
 */
export function SessionWatcher() {
  const router = useRouter();
  // onAuthStateChange fires INITIAL_SESSION on mount; refreshing on that
  // would loop, so the first event is ignored.
  const settled = useRef(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (!settled.current) {
        settled.current = true;
        if (event === "INITIAL_SESSION") return;
      }

      // With no connection, a token refresh fails and the client
      // reports SIGNED_OUT. Acting on that would throw a driver out of
      // the app in the middle of a round, onto a sign-in screen that
      // cannot load either - and their queued sales with it. A genuine
      // sign-out cannot happen offline: it is a server action. So while
      // the device is offline these events are ignored, and the next
      // real request re-resolves identity on the server anyway.
      if (typeof navigator !== "undefined" && !navigator.onLine) return;

      if (event === "SIGNED_OUT") {
        router.replace("/sign-in");
        return;
      }

      // A refreshed token or a sign-in in another tab changes who the
      // server would resolve, so the tree is re-rendered.
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        router.refresh();
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, [router]);

  return null;
}
