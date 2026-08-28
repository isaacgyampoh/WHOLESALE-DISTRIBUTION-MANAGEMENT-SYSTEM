"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { PAYMENT_METHODS } from "@/types/domain";
import { getCapabilities } from "@/lib/db/capabilities";
import { formatMoney } from "@/lib/utils/format";
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
    .from("customers").select("id, name, code, org_id, phone").eq("id", customerId).maybeSingle();
  if (!customer || customer.org_id !== actor.organizationId) {
    return { status: "error", message: "That customer could not be found.", values };
  }

  const supabase = await createSupabaseServerClient();
  // The function returns the ledger row it wrote, which is what a
  // payment receipt is issued against.
  const { data: txn, error } = await supabase.rpc("record_credit_payment", {
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

  const recorded = Array.isArray(txn) ? txn[0] : txn;

  return {
    status: "done",
    message: `Collection recorded against ${customer.name}.`,
    // For the receipt offered straight afterwards. The money is already
    // recorded by this point: a receipt that cannot be prepared does not
    // undo it.
    paymentId: (recorded?.id as string) ?? undefined,
    customerName: customer.name,
    customerPhone: (customer.phone as string | null) ?? null,
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
 * A sale made from a van while there is a signal.
 *
 * Performed here and now rather than queued. The offline path exists
 * for the case it is built for - no network - and routing an online
 * sale through it would make the till depend on the sync engine being
 * installed, which is a separate migration and a separate concern.
 *
 * The stock and ledger rules are still not reimplemented: the rows are
 * assembled and complete_van_sale() does the work, exactly as the
 * offline path does when it drains.
 */
export async function recordVanSaleAction(input: {
  loadId: string;
  customerId: string;
  saleType: "cash" | "credit";
  notes?: string | null;
  lines: {
    product_id: string;
    /** Whole units. May be zero when the line is loose pieces only. */
    quantity: number;
    /** Loose pieces. May be zero. Both zero is not a line. */
    pieces?: number;
    unit_price: number;
    /** What one loose piece was charged at on this sale. */
    piece_price?: number;
    tax_rate: number;
  }[];
  /**
   * How the customer paid, in the terms a driver thinks in.
   *
   * Deliberately not a list of amounts. The payable total includes tax
   * and is computed by the database from the same lines, so a till that
   * sent its own figures would be short by exactly the tax - which is
   * what happened when it did. The driver says how they were paid, and
   * for a split how much of it was cash; the rest follows from the real
   * total.
   */
  payment?: {
    kind: "cash" | "momo" | "split" | "credit";
    /** Split only: how much of the total came in as notes. */
    cashPart?: number;
    /** A momo transaction id, where there is one. */
    reference?: string | null;
    /** Which mobile money network. Meaningless on a cash payment. */
    provider?: string | null;
  };
}): Promise<{
  ok: boolean;
  saleId?: string;
  saleNumber?: string;
  total?: number;
  balance?: number;
  /** In words, for the confirmation the driver reads back. */
  paidBy?: string;
  message?: string;
}> {
  const actor = await requirePermission("sales.create");

  if (!input.loadId) return { ok: false, message: "Choose the load being sold from." };
  if (!input.customerId) return { ok: false, message: "Choose a customer." };
  if (!input.lines?.length) return { ok: false, message: "Add something to the sale." };
  if (input.saleType !== "cash" && input.saleType !== "credit") {
    return { ok: false, message: "Choose cash or credit." };
  }

  const admin = createSupabaseAdminClient();

  const { data: load } = await admin
    .from("van_loads")
    .select("id, org_id, status, van_id, driver_id, load_number")
    .eq("id", input.loadId)
    .maybeSingle();
  if (!load || load.org_id !== actor.organizationId) {
    return { ok: false, message: "That load could not be found." };
  }
  if (load.status !== "dispatched" && load.status !== "loaded") {
    return { ok: false, message: `${load.load_number} is ${load.status} and cannot take sales.` };
  }

  // The van has to be the caller's own.
  //
  // The browser sends the load, and until this check that was taken on
  // trust: anybody holding sales.create could sell another van's stock
  // by naming its load. Row level security does not catch it because
  // everything here runs with the service role.
  //
  // The office is exempt - settling somebody else's round is their job -
  // which is the same line complete_van_sale draws. That function is the
  // boundary that governs; this is here so the refusal is a sentence the
  // salesperson can act on rather than a raised exception.
  const officeCanSellAnywhere =
    actor.role === "admin" || actor.role === "senior_manager" || actor.role === "manager";

  if (!officeCanSellAnywhere) {
    const { data: crewed } = await admin
      .from("van_assignments")
      .select("van_id")
      .eq("member_id", actor.id)
      .is("unassigned_at", null)
      .maybeSingle();

    if (!crewed) {
      return {
        ok: false,
        message: "You are not crewed on a van. Ask the office to put you on one before selling.",
      };
    }
    if (crewed.van_id !== load.van_id) {
      return {
        ok: false,
        message: "That load belongs to another van. You can only sell from the van you are on.",
      };
    }
  }

  const { data: customer } = await admin
    .from("customers").select("id, name, org_id, is_active")
    .eq("id", input.customerId).maybeSingle();
  if (!customer || customer.org_id !== actor.organizationId) {
    return { ok: false, message: "That customer could not be found." };
  }
  if (!customer.is_active) return { ok: false, message: "That customer is no longer active." };

  // What the van is actually carrying decides what can be sold. Checked
  // here for a clear message; complete_van_sale() checks it again, and
  // that is the one that governs.
  const capabilities = await getCapabilities();

  for (const line of input.lines) {
    const units = Number(line.quantity ?? 0);
    const pieces = capabilities.loosePieces ? Number(line.pieces ?? 0) : 0;

    if (!Number.isInteger(units) || units < 0 ||
        !Number.isInteger(pieces) || pieces < 0) {
      return { ok: false, message: "Quantities must be whole numbers, zero or more." };
    }
    // A line for nothing at all is a mistake, not a sale - the same rule
    // the database holds. Either half may be zero; both may not.
    if (units === 0 && pieces === 0) {
      return { ok: false, message: "Every line needs a quantity above zero." };
    }

    const { data: held } = await admin
      .from("van_inventory")
      .select(capabilities.loosePieces
        ? "qty_on_hand, qty_pieces, products(name)"
        : "qty_on_hand, products(name)")
      .eq("van_id", load.van_id).eq("product_id", line.product_id).maybeSingle();

    const board = held as {
      qty_on_hand?: number; qty_pieces?: number; products?: { name?: string } | null;
    } | null;
    const name = board?.products?.name ?? "that product";

    const available = Number(board?.qty_on_hand ?? 0);
    if (units > available) {
      return { ok: false, message: `Only ${available} of ${name} left on the van.` };
    }

    // Judged on its own: a sealed carton on the van is not three loose
    // pieces until somebody opens it, and that happens at the depot.
    const looseAvailable = Number(board?.qty_pieces ?? 0);
    if (pieces > looseAvailable) {
      return {
        ok: false,
        message: `Only ${looseAvailable} loose pieces of ${name} left on the van.`,
      };
    }
  }

  const { data: sale, error } = await admin
    .from("van_sales")
    .insert({
      org_id: actor.organizationId,
      load_id: load.id,
      van_id: load.van_id,
      // Two different people. The salesperson is whoever is recording
      // this; the driver comes from the load. Before the crew model
      // these were the same column, which put the driver's name on
      // every receipt whoever actually made the sale.
      salesperson_id: actor.id,
      driver_id: load.driver_id,
      customer_id: input.customerId,
      sale_type: input.saleType,
      status: "draft",
      sold_at: new Date().toISOString(),
      notes: input.notes?.trim() || null,
    })
    .select("id")
    .single();

  if (error || !sale) {
    console.error("[commercial] sale creation failed", error);
    return { ok: false, message: "The sale could not be started. Please try again." };
  }

  const { error: lineError } = await admin.from("van_sale_items").insert(
    input.lines.map((l) => ({
      org_id: actor.organizationId,
      sale_id: sale.id,
      product_id: l.product_id,
      quantity: Number(l.quantity ?? 0),
      unit_price: l.unit_price,
      // Both kept on the line, so a price change tomorrow cannot rewrite
      // what this customer was billed today.
      ...(capabilities.loosePieces
        ? { pieces: Number(l.pieces ?? 0), piece_price: Number(l.piece_price ?? 0) }
        : {}),
      discount_pct: 0,
      tax_rate: l.tax_rate ?? 0,
    })),
  );
  if (lineError) {
    console.error("[commercial] sale lines failed", lineError);
    // A draft with no lines is not a sale. Remove it rather than leave
    // one nothing can complete.
    await admin.from("van_sales").delete().eq("id", sale.id);
    return { ok: false, message: "The sale lines could not be saved. Please try again." };
  }

  const supabase = await createSupabaseServerClient();

  // How it was paid, before it is completed: the breakdown may only be
  // written while the sale is still a draft, and completing it is what
  // moves the stock and the ledger. Probed once above and reused.

  // What is actually owed, including tax, worked out by the database
  // from the lines just written. Everything below is measured against
  // this rather than against anything the till sent.
  const { data: priced } = await admin
    .from("van_sales").select("total").eq("id", sale.id).single();
  const payable = Number(priced?.total ?? 0);

  const kind = input.payment?.kind ?? (input.saleType === "credit" ? "credit" : "cash");
  const reference = input.payment?.reference?.trim() || null;
  // Which network. A reference is only matchable against a statement
  // once you know whose system issued it.
  const provider = input.payment?.provider?.trim() || null;

  const breakdown: {
    method: string; amount: number; reference?: string | null; provider?: string | null;
  }[] = [];
  if (kind === "cash") {
    breakdown.push({ method: "cash", amount: payable });
  } else if (kind === "momo") {
    breakdown.push({ method: "mobile_money", amount: payable, reference, provider });
  } else if (kind === "split") {
    const cash = Math.min(Math.max(Number(input.payment?.cashPart ?? 0), 0), payable);
    const momo = Number((payable - cash).toFixed(2));
    if (cash > 0) breakdown.push({ method: "cash", amount: Number(cash.toFixed(2)) });
    if (momo > 0) breakdown.push({ method: "mobile_money", amount: momo, reference, provider });
    if (!breakdown.length) {
      await admin.from("van_sale_items").delete().eq("sale_id", sale.id);
      await admin.from("van_sales").delete().eq("id", sale.id);
      return { ok: false, message: "Enter how much was paid in cash." };
    }
  }
  // Credit: nothing taken at the counter, so no breakdown.

  let amountPaid: number | null = null;
  if (breakdown.length && capabilities.salePaymentMethods) {
    const { data: taken, error: paymentError } = await supabase.rpc("record_sale_payments", {
      p_sale_id: sale.id,
      p_payments: breakdown,
    });

    if (paymentError) {
      console.error("[commercial] sale payment failed", paymentError);
      await admin.from("van_sale_items").delete().eq("sale_id", sale.id);
      await admin.from("van_sales").delete().eq("id", sale.id);
      return {
        ok: false,
        message: paymentError.message.replace(/^.*?:\s*/, "") || "That payment could not be recorded.",
      };
    }
    amountPaid = Number(taken ?? 0);
  } else if (breakdown.length) {
    // No breakdown table on this database. The sale is still recorded
    // with what was taken, exactly as it was before methods existed.
    amountPaid = breakdown.reduce((sum, p) => sum + p.amount, 0);
  }

  const { error: completeError } = await supabase.rpc("complete_van_sale", {
    p_sale_id: sale.id,
    p_amount_paid: amountPaid,
  });
  if (completeError) {
    console.error("[commercial] sale completion failed", completeError);
    await admin.from("van_sale_items").delete().eq("sale_id", sale.id);
    await admin.from("van_sales").delete().eq("id", sale.id);
    return {
      ok: false,
      message: completeError.message.replace(/^.*?:\s*/, "") || "The sale could not be completed.",
    };
  }

  const { data: finished } = await admin
    .from("van_sales").select("sale_number, total, balance").eq("id", sale.id).single();

  await recordAudit(actor, {
    action: "sale.recorded",
    targetType: "van_sale",
    targetId: sale.id,
    targetLabel: finished?.sale_number ?? "",
    after: {
      customer: customer.name,
      sale_type: input.saleType,
      lines: input.lines.length,
      total: finished?.total,
      balance: finished?.balance,
      paid_by: breakdown.map((p) => `${p.method} ${p.amount}`),
    },
  });

  revalidatePath("/sales");
  revalidatePath("/driver");
  revalidatePath("/driver/sell");
  revalidatePath("/driver/stock");

  const METHOD_WORDS: Record<string, string> = {
    cash: "cash", mobile_money: "mobile money",
  };

  return {
    ok: true,
    // Returned so the confirmation can offer the receipt straight away.
    // Issuing one is a separate step on purpose: a receipt that cannot
    // be prepared must never undo a sale that already happened.
    saleId: sale.id as string,
    saleNumber: finished?.sale_number as string,
    total: Number(finished?.total ?? 0),
    balance: Number(finished?.balance ?? 0),
    paidBy: breakdown.length
      ? breakdown
          .map((p) => `${formatMoney(p.amount)} ${METHOD_WORDS[p.method] ?? p.method}`)
          .join(", ")
      : "on credit",
  };
}
