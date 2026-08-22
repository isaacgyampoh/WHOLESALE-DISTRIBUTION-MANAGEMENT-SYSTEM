"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { getCapabilities } from "@/lib/db/capabilities";

/**
 * Marking notifications read.
 *
 * The only thing a person does to one. Which rows are theirs is decided
 * by the database function, not by an id list sent from the browser:
 * passing no ids marks everything the caller can currently see, and
 * everything they cannot see is untouched whatever they pass.
 */
export async function markNotificationsReadAction(ids?: string[]): Promise<void> {
  await requireUser();
  if (!(await getCapabilities()).notifications) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("mark_notifications_read", {
    p_ids: ids && ids.length ? ids : undefined,
  });

  if (error) {
    console.error("[notifications] could not be marked read", error);
    return;
  }

  revalidatePath("/", "layout");
}
