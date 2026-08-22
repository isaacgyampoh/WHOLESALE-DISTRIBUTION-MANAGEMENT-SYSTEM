"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { PAYMENT_METHODS } from "@/types/domain";
import type { CommercialState } from "./state";

/**
 * Commercial changes.
 *
 * A collection is not written as a row here. It goes through
 * record_credit_payment(), which is where the rule that a payment is a
 * negative entry on the customer ledger actually lives. Writing the row
 * directly would put a second copy of that rule in TypeScript, and the
 * two would eventually disagree.
 *
 * The call runs under the caller's own session rather than the admin
 * client, so the function's own require_role() check sees the real
 * caller and RLS still applies to the customer being paid against.
 */

const MONEY = /^\d{1,9}(\.\d{1,2})?$/;

export async function recordCollectionAction(
  _prev: CommercialState,
  formData: FormData,
): Promise<CommercialState> {
  const actor = await requirePermission("payments.create");

  const customerId = String(formData.get("customerId") ?? "");
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const method = String(formData.get("method") ?? "cash");
  const notes = String(formData.get("notes") ?? "").trim();
  const values = { customerId, amount: amountRaw, method, notes };
  const errors: Record<string, string> = {};

  if (!customerId) errors.customerId = "Choose a customer.";
  if (!amountRaw) errors.amount = "Enter an amount.";
  else if (!MONEY.test(amountRaw)) errors.amount = "Use a number with at most two decimal places.";
  else if (Number(amountRaw) <= 0) errors.amount = "Enter an amount above zero.";
  if (!PAYMENT_METHODS.includes(method as (typeof PAYMENT_METHODS)[number])) {
    errors.method = "Choose how the money was received.";
  }

  if (Object.keys(errors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors: errors };
  }

  // Confirm the customer is one of ours before naming them in the audit
  // entry. The database refuses a foreign customer regardless; this is
  // so the message says something useful.
  const admin = createSupabaseAdminClient();
  const { data: customer } = await admin
    .from("customers").select("id, name, code, org_id").eq("id", customerId).maybeSingle();
  if (!customer || customer.org_id !== actor.organizationId) {
    return { status: "error", message: "That customer could not be found.", values };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_credit_payment", {
    p_customer_id: customerId,
    p_amount: Number(amountRaw),
    p_method: method,
    p_notes: notes || null,
  });

  if (error) {
    console.error("[commercial] collection failed", error);
    return { status: "error", message: "The collection could not be recorded. Please try again.", values };
  }

  await recordAudit(actor, {
    action: "payment.recorded",
    targetType: "customer",
    targetId: customerId,
    targetLabel: `${customer.code} ${customer.name}`,
    after: { amount: Number(amountRaw), method, notes: notes || null },
  });

  revalidatePath("/payments");
  revalidatePath("/credit");
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);

  return {
    status: "done",
    message: `Collection recorded against ${customer.name}.`,
  };
}

// ===================================================================
// Customers
// ===================================================================

const WHOLE = /^\d{1,9}$/;

async function ownedRow(
  actor: { organizationId: string }, table: string, id: string, columns: string,
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from(table).select(columns).eq("id", id).maybeSingle();
  const row = data as Record<string, unknown> | null;
  return row && row.org_id === actor.organizationId ? row : null;
}

export async function saveCustomerAction(
  _prev: CommercialState,
  formData: FormData,
): Promise<CommercialState> {
  const id = String(formData.get("id") ?? "");
  const actor = await requirePermission(id ? "customers.edit" : "customers.create");

  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const region = String(formData.get("region") ?? "").trim();
  const address = String(formData.get("billingAddress") ?? "").trim();
  const creditLimit = String(formData.get("creditLimit") ?? "0").trim() || "0";
  const paymentTerms = String(formData.get("paymentTermsDays") ?? "0").trim() || "0";
  const values = {
    id, code, name, contactName, phone, city, region,
    billingAddress: address, creditLimit, paymentTermsDays: paymentTerms,
  };
  const fieldErrors: Record<string, string> = {};

  if (!code) fieldErrors.code = "Give the customer a short code.";
  if (!name) fieldErrors.name = "Enter the customer's name.";
  if (!MONEY.test(creditLimit)) fieldErrors.creditLimit = "Use an amount like 5000 or 5000.00.";
  if (!WHOLE.test(paymentTerms)) fieldErrors.paymentTermsDays = "Use a whole number of days.";

  if (Object.keys(fieldErrors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors };
  }

  const admin = createSupabaseAdminClient();
  const row = {
    code, name,
    contact_name: contactName || null,
    phone: phone || null,
    city: city || null,
    region: region || null,
    billing_address: address || null,
    credit_limit: Number(creditLimit),
    payment_terms_days: Number(paymentTerms),
  };

  if (id) {
    const existing = await ownedRow(actor, "customers", id, "id, code, name, credit_limit, org_id");
    if (!existing) return { status: "error", message: "That customer could not be found.", values };

    const { error } = await admin.from("customers").update(row).eq("id", id);
    if (error) {
      console.error("[commercial] customer update failed", error);
      return {
        status: "error", values,
        message: error.code === "23505"
          ? "Another customer already uses that code."
          : "The customer could not be saved.",
      };
    }
    await recordAudit(actor, {
      action: "customer.updated", targetType: "customer", targetId: id, targetLabel: `${code} ${name}`,
      before: { code: existing.code, name: existing.name, credit_limit: existing.credit_limit },
      after: row,
    });
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
    return { status: "done", message: `${name} saved.` };
  }

  const { data, error } = await admin
    .from("customers")
    .insert({ ...row, org_id: actor.organizationId, created_by: actor.id })
    .select("id").single();
  if (error || !data) {
    console.error("[commercial] customer creation failed", error);
    return {
      status: "error", values,
      message: error?.code === "23505"
        ? "A customer with that code already exists."
        : "The customer could not be created.",
    };
  }

  await recordAudit(actor, {
    action: "customer.created", targetType: "customer", targetId: data.id,
    targetLabel: `${code} ${name}`, after: row,
  });
  revalidatePath("/customers");
  return { status: "done", message: `${name} added.`, createdId: data.id };
}

export async function setCustomerActiveAction(
  _prev: CommercialState,
  formData: FormData,
): Promise<CommercialState> {
  const actor = await requirePermission("customers.edit");
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";

  const customer = await ownedRow(actor, "customers", id, "id, name, org_id, is_active");
  if (!customer) return { status: "error", message: "That customer could not be found." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("customers").update({ is_active: active }).eq("id", id);
  if (error) {
    console.error("[commercial] customer status failed", error);
    return { status: "error", message: "The customer could not be updated." };
  }

  await recordAudit(actor, {
    action: active ? "customer.activated" : "customer.deactivated",
    targetType: "customer", targetId: id, targetLabel: String(customer.name),
    before: { is_active: customer.is_active }, after: { is_active: active },
  });

  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  return { status: "done", message: `${customer.name} is now ${active ? "active" : "inactive"}.` };
}

// ===================================================================
// Van sales
// ===================================================================

/**
 * A sale made from a van, recorded while online.
 *
 * It goes through sync_submit() rather than writing van_sales directly,
 * for two reasons. The stock and ledger rules live in
 * complete_van_sale(), and sync_submit() is what enforces idempotency -
 * so an online sale and one that was queued in a tunnel take exactly
 * the same path, and a double-submitted form cannot produce two sales.
 */
export async function recordVanSaleAction(
  _prev: CommercialState,
  formData: FormData,
): Promise<CommercialState> {
  const actor = await requirePermission("sales.create");

  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
  const loadId = String(formData.get("loadId") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const saleType = String(formData.get("saleType") ?? "cash");
  const amountPaid = String(formData.get("amountPaid") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const values = { loadId, customerId, saleType, amountPaid, notes };
  const fieldErrors: Record<string, string> = {};

  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
    return { status: "error", message: "This form is stale. Reload the page and try again.", values };
  }
  if (!loadId) fieldErrors.loadId = "Choose the load being sold from.";
  if (!customerId) fieldErrors.customerId = "Choose a customer.";
  if (saleType !== "cash" && saleType !== "credit") fieldErrors.saleType = "Choose cash or credit.";
  if (amountPaid && !MONEY.test(amountPaid)) fieldErrors.amountPaid = "Use an amount like 250 or 250.00.";

  const productIds = formData.getAll("productId").map(String);
  const quantities = formData.getAll("quantity").map(String);
  const prices = formData.getAll("unitPrice").map(String);

  const lines: { product_id: string; quantity: number; unit_price: number; tax_rate: number }[] = [];
  for (const [i, productId] of productIds.entries()) {
    const q = (quantities[i] ?? "").trim();
    const p = (prices[i] ?? "").trim();
    if (!productId || !q || q === "0") continue;
    if (!WHOLE.test(q)) { fieldErrors.lines = `Line ${i + 1}: quantity must be a whole number.`; break; }
    if (p && !MONEY.test(p)) { fieldErrors.lines = `Line ${i + 1}: price must be an amount.`; break; }
    lines.push({
      product_id: productId, quantity: Number(q),
      unit_price: p ? Number(p) : 0, tax_rate: 0,
    });
  }
  if (!lines.length && !fieldErrors.lines) fieldErrors.lines = "Add at least one product.";

  if (Object.keys(fieldErrors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors };
  }

  // Prices default to what the load was priced at, so a driver never
  // has to retype them and cannot accidentally sell at zero.
  const admin = createSupabaseAdminClient();
  const { data: loadItems } = await admin
    .from("van_load_items").select("product_id, unit_price").eq("load_id", loadId);
  const priceBy = new Map((loadItems ?? []).map((i) => [i.product_id as string, Number(i.unit_price)]));
  const { data: taxes } = await admin
    .from("products").select("id, tax_rate").in("id", lines.map((l) => l.product_id));
  const taxBy = new Map((taxes ?? []).map((p) => [p.id as string, Number(p.tax_rate ?? 0)]));

  for (const line of lines) {
    if (!line.unit_price) line.unit_price = priceBy.get(line.product_id) ?? 0;
    line.tax_rate = taxBy.get(line.product_id) ?? 0;
    if (!line.unit_price) {
      return {
        status: "error", values,
        message: "Check the fields below.",
        fieldErrors: { lines: "One of those products has no price on this load." },
      };
    }
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("sync_submit", {
    p_id: idempotencyKey,
    p_device_id: "web",
    p_operation: "van_sale",
    p_payload: {
      load_id: loadId,
      customer_id: customerId,
      sale_type: saleType,
      amount_paid: saleType === "cash" ? null : (amountPaid || "0"),
      notes: notes || null,
      lines,
    },
    p_occurred_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[commercial] sale failed", error);
    return { status: "error", message: "The sale could not be recorded. Please try again.", values };
  }

  const outcome = data as { status?: string; error?: string; result?: Record<string, unknown> } | null;
  if (outcome?.status !== "applied") {
    return {
      status: "error", values,
      message: outcome?.error?.replace(/^.*?:\s*/, "") ?? "The sale could not be completed.",
    };
  }

  const result = outcome.result ?? {};
  await recordAudit(actor, {
    action: "sale.recorded",
    targetType: "van_sale",
    targetId: String(result.sale_id ?? ""),
    targetLabel: String(result.sale_number ?? ""),
    after: {
      total: result.total, balance: result.balance,
      sale_type: saleType, lines: lines.length,
    },
  });

  revalidatePath("/sales");
  revalidatePath("/vans");
  revalidatePath("/credit");
  return {
    status: "done",
    message: `${result.sale_number} recorded.`,
    createdId: String(result.sale_id ?? ""),
  };
}
