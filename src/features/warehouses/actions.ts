"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import type { AuthenticatedUser } from "@/types/domain";
import type { WarehouseState } from "./state";

/**
 * Warehouses, suppliers and inbound goods.
 *
 * Receiving is the only one of these that moves stock, and it does not
 * do so here: receive_purchase_line() posts the movement and advances
 * the order in one transaction. This module validates, records who did
 * it, and calls that function.
 */

const WHOLE = /^\d{1,9}$/;
const MONEY = /^\d{1,9}(\.\d{1,2})?$/;

function fail(message: string, values?: Record<string, string>): WarehouseState {
  return { status: "error", message, values };
}

async function owned(
  actor: AuthenticatedUser, table: string, id: string, columns: string,
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from(table).select(columns).eq("id", id).maybeSingle();
  const row = data as Record<string, unknown> | null;
  return row && row.org_id === actor.organizationId ? row : null;
}

// ===================================================================
// Warehouses
// ===================================================================

export async function saveWarehouseAction(
  _prev: WarehouseState,
  formData: FormData,
): Promise<WarehouseState> {
  const actor = await requirePermission("inventory.transfer");

  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const isDefault = String(formData.get("isDefault") ?? "") === "on";
  const values = { id, code, name, city, address };
  const fieldErrors: Record<string, string> = {};

  if (!code) fieldErrors.code = "Give the warehouse a short code.";
  if (!name) fieldErrors.name = "Give the warehouse a name.";

  if (Object.keys(fieldErrors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors };
  }

  const admin = createSupabaseAdminClient();
  const row = { code, name, city: city || null, address: address || null, is_default: isDefault };

  // Exactly one default, or stock adjustments have nowhere obvious to
  // land. Clearing the others first keeps that true.
  if (isDefault) {
    await admin.from("warehouses")
      .update({ is_default: false }).eq("org_id", actor.organizationId);
  }

  if (id) {
    const existing = await owned(actor, "warehouses", id, "id, code, name, org_id");
    if (!existing) return fail("That warehouse could not be found.", values);

    const { error } = await admin.from("warehouses").update(row).eq("id", id);
    if (error) {
      console.error("[warehouses] update failed", error);
      return fail(error.code === "23505"
        ? "Another warehouse already uses that code."
        : "The warehouse could not be saved.", values);
    }
    await recordAudit(actor, {
      action: "warehouse.updated", targetType: "warehouse", targetId: id, targetLabel: name,
      before: { code: existing.code, name: existing.name }, after: row,
    });
    revalidatePath("/warehouses");
    return { status: "done", message: `${name} saved.` };
  }

  const { data, error } = await admin
    .from("warehouses").insert({ ...row, org_id: actor.organizationId }).select("id").single();
  if (error || !data) {
    console.error("[warehouses] creation failed", error);
    return fail(error?.code === "23505"
      ? "A warehouse with that code already exists."
      : "The warehouse could not be created.", values);
  }

  await recordAudit(actor, {
    action: "warehouse.created", targetType: "warehouse", targetId: data.id,
    targetLabel: name, after: row,
  });
  revalidatePath("/warehouses");
  return { status: "done", message: `${name} added.`, createdId: data.id };
}

export async function setWarehouseActiveAction(
  _prev: WarehouseState,
  formData: FormData,
): Promise<WarehouseState> {
  const actor = await requirePermission("inventory.transfer");
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";

  const warehouse = await owned(actor, "warehouses", id, "id, name, org_id, is_active, is_default");
  if (!warehouse) return fail("That warehouse could not be found.");

  const admin = createSupabaseAdminClient();

  if (!active) {
    // Closing a warehouse that still holds stock would hide it from
    // every count without moving it anywhere.
    const { data: held } = await admin
      .from("inventory").select("qty_on_hand").eq("warehouse_id", id).gt("qty_on_hand", 0);
    if (held?.length) {
      return fail(`${warehouse.name} still holds stock. Transfer or adjust it out first.`);
    }
    if (warehouse.is_default) {
      return fail("This is the default warehouse. Make another one default first.");
    }
  }

  const { error } = await admin.from("warehouses").update({ is_active: active }).eq("id", id);
  if (error) {
    console.error("[warehouses] status failed", error);
    return fail("The warehouse could not be updated.");
  }

  await recordAudit(actor, {
    action: active ? "warehouse.activated" : "warehouse.deactivated",
    targetType: "warehouse", targetId: id, targetLabel: String(warehouse.name),
    before: { is_active: warehouse.is_active }, after: { is_active: active },
  });

  revalidatePath("/warehouses");
  return { status: "done", message: `${warehouse.name} is now ${active ? "active" : "inactive"}.` };
}

// ===================================================================
// Suppliers
// ===================================================================

export async function saveSupplierAction(
  _prev: WarehouseState,
  formData: FormData,
): Promise<WarehouseState> {
  const actor = await requirePermission("inventory.transfer");

  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const paymentTerms = String(formData.get("paymentTermsDays") ?? "30").trim() || "30";
  const leadTime = String(formData.get("leadTimeDays") ?? "7").trim() || "7";
  const values = { id, code, name, contactName, phone, email, paymentTermsDays: paymentTerms, leadTimeDays: leadTime };
  const fieldErrors: Record<string, string> = {};

  if (!code) fieldErrors.code = "Give the supplier a short code.";
  if (!name) fieldErrors.name = "Give the supplier a name.";
  if (!WHOLE.test(paymentTerms)) fieldErrors.paymentTermsDays = "Use a whole number of days.";
  if (!WHOLE.test(leadTime)) fieldErrors.leadTimeDays = "Use a whole number of days.";
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fieldErrors.email = "That does not look like an email address.";
  }

  if (Object.keys(fieldErrors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors };
  }

  const admin = createSupabaseAdminClient();
  const row = {
    code, name,
    contact_name: contactName || null,
    phone: phone || null,
    email: email || null,
    payment_terms_days: Number(paymentTerms),
    lead_time_days: Number(leadTime),
  };

  if (id) {
    const existing = await owned(actor, "suppliers", id, "id, code, name, org_id");
    if (!existing) return fail("That supplier could not be found.", values);

    const { error } = await admin.from("suppliers").update(row).eq("id", id);
    if (error) {
      console.error("[suppliers] update failed", error);
      return fail(error.code === "23505"
        ? "Another supplier already uses that code."
        : "The supplier could not be saved.", values);
    }
    await recordAudit(actor, {
      action: "supplier.updated", targetType: "supplier", targetId: id, targetLabel: name,
      before: { code: existing.code, name: existing.name }, after: row,
    });
    revalidatePath("/purchasing");
    return { status: "done", message: `${name} saved.` };
  }

  const { data, error } = await admin
    .from("suppliers")
    .insert({ ...row, org_id: actor.organizationId, created_by: actor.id })
    .select("id").single();
  if (error || !data) {
    console.error("[suppliers] creation failed", error);
    return fail(error?.code === "23505"
      ? "A supplier with that code already exists."
      : "The supplier could not be created.", values);
  }

  await recordAudit(actor, {
    action: "supplier.created", targetType: "supplier", targetId: data.id,
    targetLabel: name, after: row,
  });
  revalidatePath("/purchasing");
  return { status: "done", message: `${name} added.`, createdId: data.id };
}

export async function setSupplierActiveAction(
  _prev: WarehouseState,
  formData: FormData,
): Promise<WarehouseState> {
  const actor = await requirePermission("inventory.transfer");
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";

  const supplier = await owned(actor, "suppliers", id, "id, name, org_id, is_active");
  if (!supplier) return fail("That supplier could not be found.");

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("suppliers").update({ is_active: active }).eq("id", id);
  if (error) {
    console.error("[suppliers] status failed", error);
    return fail("The supplier could not be updated.");
  }

  await recordAudit(actor, {
    action: active ? "supplier.activated" : "supplier.deactivated",
    targetType: "supplier", targetId: id, targetLabel: String(supplier.name),
    before: { is_active: supplier.is_active }, after: { is_active: active },
  });

  revalidatePath("/purchasing");
  return { status: "done", message: `${supplier.name} is now ${active ? "active" : "inactive"}.` };
}

// ===================================================================
// Purchase orders
// ===================================================================

export async function createPurchaseOrderAction(
  _prev: WarehouseState,
  formData: FormData,
): Promise<WarehouseState> {
  const actor = await requirePermission("inventory.transfer");

  const supplierId = String(formData.get("supplierId") ?? "");
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const expectedDate = String(formData.get("expectedDate") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  // The supplier's own reference, if they have already quoted one. It is
  // what they say on the phone when they ring about payment, and having
  // it on the order is what lets an invoice be matched to it later.
  const supplierInvoiceNumber = String(formData.get("supplierInvoiceNumber") ?? "").trim();
  const supplierInvoiceDate = String(formData.get("supplierInvoiceDate") ?? "").trim();
  const values = {
    supplierId, warehouseId, expectedDate, notes,
    supplierInvoiceNumber, supplierInvoiceDate,
  };
  const fieldErrors: Record<string, string> = {};

  if (!supplierId) fieldErrors.supplierId = "Choose a supplier.";
  if (!warehouseId) fieldErrors.warehouseId = "Choose where the goods are delivered.";

  const productIds = formData.getAll("productId").map(String);
  const quantities = formData.getAll("quantity").map(String);
  const costs = formData.getAll("unitCost").map(String);

  const lines: { productId: string; quantity: number; unitCost: number }[] = [];
  for (const [i, productId] of productIds.entries()) {
    const q = (quantities[i] ?? "").trim();
    const c = (costs[i] ?? "").trim();
    if (!productId || !q || q === "0") continue;
    if (!WHOLE.test(q)) { fieldErrors.lines = `Line ${i + 1}: quantity must be a whole number.`; break; }
    if (c && !MONEY.test(c)) { fieldErrors.lines = `Line ${i + 1}: cost must be an amount.`; break; }
    lines.push({ productId, quantity: Number(q), unitCost: c ? Number(c) : 0 });
  }
  if (!lines.length && !fieldErrors.lines) fieldErrors.lines = "Add at least one product.";

  if (Object.keys(fieldErrors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors };
  }

  const supplier = await owned(actor, "suppliers", supplierId, "id, name, org_id, is_active");
  if (!supplier) return fail("That supplier could not be found.", values);
  if (!supplier.is_active) return fail("That supplier is not active.", values);

  const warehouse = await owned(actor, "warehouses", warehouseId, "id, name, org_id");
  if (!warehouse) return fail("That warehouse could not be found.", values);

  const admin = createSupabaseAdminClient();
  const { data: po, error } = await admin
    .from("purchase_orders")
    .insert({
      org_id: actor.organizationId, supplier_id: supplierId, warehouse_id: warehouseId,
      status: "draft", order_date: new Date().toISOString().slice(0, 10),
      expected_date: expectedDate || null, notes: notes || null, created_by: actor.id,
      supplier_invoice_number: supplierInvoiceNumber || null,
      supplier_invoice_date: supplierInvoiceDate || null,
    })
    .select("id, po_number").single();

  if (error || !po) {
    console.error("[purchasing] order creation failed", error);
    return fail("The purchase order could not be created. Please try again.", values);
  }

  const { error: lineError } = await admin.from("purchase_order_items").insert(
    await Promise.all(lines.map(async (line) => {
      // Fall back to the product's own cost so a blank column still
      // produces a priced order rather than a zero-value one.
      const { data: product } = await admin
        .from("products").select("cost_price, tax_rate").eq("id", line.productId).maybeSingle();
      return {
        org_id: actor.organizationId, po_id: po.id, product_id: line.productId,
        quantity: line.quantity,
        unit_cost: line.unitCost || Number(product?.cost_price ?? 0),
        tax_rate: Number(product?.tax_rate ?? 0),
      };
    })),
  );

  if (lineError) {
    console.error("[purchasing] order lines failed", lineError);
    await admin.from("purchase_orders").delete().eq("id", po.id);
    return fail("The order lines could not be saved. Please try again.", values);
  }

  await recordAudit(actor, {
    action: "purchase.created", targetType: "purchase_order", targetId: po.id,
    targetLabel: po.po_number,
    after: { supplier: supplier.name, warehouse: warehouse.name, lines: lines.length },
  });

  revalidatePath("/purchasing");
  return {
    status: "done",
    message: `${po.po_number} created as a draft.`,
    createdId: po.id, createdNumber: po.po_number,
  };
}

export async function submitPurchaseOrderAction(
  _prev: WarehouseState,
  formData: FormData,
): Promise<WarehouseState> {
  const actor = await requirePermission("inventory.transfer");
  const id = String(formData.get("id") ?? "");

  const po = await owned(actor, "purchase_orders", id, "id, po_number, org_id, status");
  if (!po) return fail("That purchase order could not be found.");
  if (po.status !== "draft") return fail(`${po.po_number} is already ${po.status}.`);

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("purchase_orders").update({ status: "submitted" }).eq("id", id);
  if (error) {
    console.error("[purchasing] submit failed", error);
    return fail("The order could not be submitted.");
  }

  await recordAudit(actor, {
    action: "purchase.submitted", targetType: "purchase_order", targetId: id,
    targetLabel: String(po.po_number),
  });

  revalidatePath("/purchasing");
  return { status: "done", message: `${po.po_number} sent to the supplier.` };
}

export async function cancelPurchaseOrderAction(
  _prev: WarehouseState,
  formData: FormData,
): Promise<WarehouseState> {
  const actor = await requirePermission("inventory.transfer");
  const id = String(formData.get("id") ?? "");

  const po = await owned(actor, "purchase_orders", id, "id, po_number, org_id, status");
  if (!po) return fail("That purchase order could not be found.");
  if (po.status === "received") return fail(`${po.po_number} has been received in full.`);

  const admin = createSupabaseAdminClient();

  // Part-received goods are already in the warehouse; cancelling would
  // leave stock with no order behind it.
  const { data: received } = await admin
    .from("purchase_order_items").select("qty_received").eq("po_id", id).gt("qty_received", 0);
  if (received?.length) {
    return fail(`${po.po_number} has goods already received and cannot be cancelled.`);
  }

  const { error } = await admin.from("purchase_orders").update({ status: "cancelled" }).eq("id", id);
  if (error) {
    console.error("[purchasing] cancel failed", error);
    return fail("The order could not be cancelled.");
  }

  await recordAudit(actor, {
    action: "purchase.cancelled", targetType: "purchase_order", targetId: id,
    targetLabel: String(po.po_number), before: { status: po.status },
  });

  revalidatePath("/purchasing");
  return { status: "done", message: `${po.po_number} cancelled.` };
}

/**
 * Receiving. Each line goes through receive_purchase_line(), which
 * posts the stock movement and advances the order status in one
 * transaction. Quantities are never written from here.
 */
export async function receivePurchaseOrderAction(
  _prev: WarehouseState,
  formData: FormData,
): Promise<WarehouseState> {
  const actor = await requirePermission("inventory.transfer");

  const id = String(formData.get("id") ?? "");
  const po = await owned(actor, "purchase_orders", id, "id, po_number, org_id, status");
  if (!po) return fail("That purchase order could not be found.");
  if (po.status === "cancelled") return fail(`${po.po_number} was cancelled.`);

  const itemIds = formData.getAll("itemId").map(String);
  const receiving = formData.getAll("qtyReceiving").map(String);
  const batchNumbers = formData.getAll("batchNumber").map(String);
  const expiryDates = formData.getAll("expiresOn").map(String);

  const admin = createSupabaseAdminClient();
  const { data: items } = await admin
    .from("purchase_order_items")
    .select("id, quantity, qty_received, products(name, track_batches, track_expiry)")
    .eq("po_id", id);
  const byId = new Map((items ?? []).map((i) => [i.id as string, i]));

  const toReceive: {
    itemId: string; quantity: number; label: string;
    batchNumber: string | null; expiresOn: string | null;
  }[] = [];

  for (const [i, itemId] of itemIds.entries()) {
    const raw = (receiving[i] ?? "").trim();
    if (!itemId || !raw || raw === "0") continue;
    if (!WHOLE.test(raw)) {
      return { status: "error", message: "Quantities must be whole numbers." };
    }
    const item = byId.get(itemId);
    if (!item) return fail("That order line could not be found.");

    const product = item.products as
      { name?: string; track_batches?: boolean; track_expiry?: boolean } | null;
    const name = product?.name ?? "a line";

    const outstanding = Number(item.quantity) - Number(item.qty_received);
    if (Number(raw) > outstanding) {
      return fail(`More received than ordered on ${name}: ${raw} against ${outstanding} outstanding.`);
    }

    const batchNumber = (batchNumbers[i] ?? "").trim();
    const expiresOn = (expiryDates[i] ?? "").trim();

    // Caught here so the message names the product. The database
    // refuses either way - receive_purchase_batch() owns the rule.
    if (product?.track_batches && !batchNumber) {
      return fail(`${name} is batch tracked. Enter the batch number from the delivery note.`);
    }
    if (product?.track_expiry && !expiresOn) {
      return fail(`${name} carries an expiry date. Enter the one on the delivery.`);
    }
    if (expiresOn && new Date(expiresOn) <= new Date(new Date().toDateString())) {
      return fail(`That delivery of ${name} is already out of date. Refuse it rather than booking it in.`);
    }

    toReceive.push({
      itemId, quantity: Number(raw), label: name,
      batchNumber: batchNumber || null,
      expiresOn: expiresOn || null,
    });
  }

  if (!toReceive.length) return fail("Enter what actually arrived.");

  const supabase = await createSupabaseServerClient();
  for (const line of toReceive) {
    // receive_purchase_batch wraps receive_purchase_line: it posts the
    // same stock movement and adds the batch record around it. A line
    // for a product that tracks nothing behaves exactly as before.
    const { error } = await supabase.rpc("receive_purchase_batch", {
      p_item_id: line.itemId,
      p_quantity: line.quantity,
      p_batch_number: line.batchNumber,
      p_expires_on: line.expiresOn,
      p_manufactured_on: null,
    });
    if (error) {
      console.error("[purchasing] receiving failed", error);
      return fail(
        `${line.label}: ${error.message.replace(/^.*?:\s*/, "")}` ||
        "The goods could not be received.");
    }
  }

  const total = toReceive.reduce((s, l) => s + l.quantity, 0);
  await recordAudit(actor, {
    action: "purchase.received", targetType: "purchase_order", targetId: id,
    targetLabel: String(po.po_number),
    after: {
      lines: toReceive.length,
      units: total,
      batches: toReceive.filter((l) => l.batchNumber).map((l) => ({
        product: l.label, batch: l.batchNumber, expires: l.expiresOn,
      })),
    },
  });

  revalidatePath("/purchasing");
  revalidatePath("/inventory");
  revalidatePath("/inventory/expiry");
  revalidatePath("/warehouses");
  return {
    status: "done",
    message: `${total} unit${total === 1 ? "" : "s"} received into stock against ${po.po_number}.`,
  };
}
