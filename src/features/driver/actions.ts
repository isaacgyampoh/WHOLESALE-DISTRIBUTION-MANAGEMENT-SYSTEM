"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";

/**
 * Things a driver does that need the server there and then.
 *
 * Almost everything on the round is queued and synced. Creating a
 * customer is the exception: the sale that follows references them by
 * id, and inventing an id on the device would mean a queued sale
 * pointing at a customer the server has never heard of. So this one
 * needs a signal, and the interface says so rather than failing later.
 */

export interface NewCustomerResult {
  ok: boolean;
  id?: string;
  code?: string;
  name?: string;
  message?: string;
}

/**
 * A customer added at the counter.
 *
 * Deliberately fewer fields than the office form: a name, a phone and
 * where they are. Credit terms are not among them - a driver may bring
 * in a customer, not decide what the business will lend them. The
 * customer starts on cash terms and a supervisor sets a limit later if
 * one is agreed.
 */
export async function createCustomerAtCounterAction(fields: {
  name: string;
  phone?: string;
  city?: string;
  address?: string;
}): Promise<NewCustomerResult> {
  const actor = await requirePermission("customers.create");

  const name = (fields.name ?? "").trim();
  if (!name) return { ok: false, message: "Enter the customer's name." };
  if (name.length > 120) return { ok: false, message: "That name is too long." };

  const admin = createSupabaseAdminClient();

  // A code the office will recognise, derived from the name and made
  // unique by a counter rather than by a random suffix, so the book
  // stays readable.
  const stem = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "CUST";
  const { data: existing } = await admin
    .from("customers")
    .select("code")
    .eq("org_id", actor.organizationId)
    .like("code", `${stem}%`);

  const taken = new Set((existing ?? []).map((c) => c.code as string));
  let code = stem;
  for (let i = 1; taken.has(code) && i < 1000; i++) code = `${stem}${i}`;

  const { data, error } = await admin
    .from("customers")
    .insert({
      org_id: actor.organizationId,
      code,
      name,
      phone: (fields.phone ?? "").trim() || null,
      city: (fields.city ?? "").trim() || null,
      billing_address: (fields.address ?? "").trim() || null,
      // Cash terms until somebody with the authority says otherwise.
      credit_limit: 0,
      payment_terms_days: 0,
      created_by: actor.id,
    })
    .select("id, code, name")
    .single();

  if (error || !data) {
    console.error("[driver] customer creation failed", error);
    return {
      ok: false,
      message: error?.code === "23505"
        ? "A customer with that code already exists. Try a slightly different name."
        : "That customer could not be saved. Please try again.",
    };
  }

  await recordAudit(actor, {
    action: "customer.created",
    targetType: "customer",
    targetId: data.id,
    targetLabel: `${data.code} ${data.name}`,
    after: { name, phone: fields.phone ?? null, city: fields.city ?? null, at_counter: true },
  });

  revalidatePath("/customers");
  revalidatePath("/driver/sell");

  return { ok: true, id: data.id, code: data.code, name: data.name };
}
