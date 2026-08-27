"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { toAppError } from "@/lib/errors/app-error";

/**
 * Inventory actions.
 *
 * Each one checks the permission here so the interface can fail early
 * with a sentence a person can read, then calls a database function that
 * checks it again for real. The second check is the one that matters:
 * these functions are reachable by POST without going through any of our
 * screens.
 *
 * Nothing writes public.inventory. Every stock change is a movement, and
 * the movement is what the database applies to the balance.
 */

export interface InventoryActionState {
  status: "idle" | "error" | "done";
  message?: string;
}

export const INITIAL_INVENTORY_STATE: InventoryActionState = { status: "idle" };

const number = (form: FormData, key: string, fallback = 0): number => {
  const raw = String(form.get(key) ?? "").trim();
  if (raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const text = (form: FormData, key: string): string => String(form.get(key) ?? "").trim();

export async function createProductAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const actor = await requirePermission("products.create");

  const name = text(formData, "name");
  const sku = text(formData, "sku");
  if (!name) return { status: "error", message: "Give the product a name." };
  if (!sku) return { status: "error", message: "Give the product an SKU." };

  const openingQty = Math.trunc(number(formData, "openingQty"));
  const warehouseId = text(formData, "warehouseId");

  if (openingQty < 0) {
    return { status: "error", message: "Opening stock cannot be a negative number." };
  }
  // Saying "50 in stock" without saying where would leave the quantity
  // with nowhere to live, so it is asked for rather than guessed at.
  if (openingQty > 0 && !warehouseId) {
    return { status: "error", message: "Choose the warehouse the opening stock is held in." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("create_product_with_stock", {
      p_sku: sku,
      p_name: name,
      p_warehouse_id: warehouseId || null,
      p_opening_qty: openingQty,
      p_category_id: text(formData, "categoryId") || null,
      p_supplier_id: null,
      p_unit_of_measure: text(formData, "unit") || "each",
      p_units_per_case: Math.max(1, Math.trunc(number(formData, "unitsPerCase", 1))),
      p_cost_price: number(formData, "costPrice"),
      p_list_price: number(formData, "listPrice"),
      p_tax_rate: number(formData, "taxRate"),
      p_reorder_point: Math.trunc(number(formData, "reorderPoint")),
      p_reorder_qty: Math.trunc(number(formData, "reorderQty")),
      p_barcode: text(formData, "barcode") || null,
      p_description: text(formData, "description") || null,
    })
    .maybeSingle();

  if (error || !data) {
    console.error("[catalogue] could not create product", error);
    return { status: "error", message: toAppError(error).userMessage };
  }

  const product = data as { id: string; sku: string; name: string };

  await recordAudit(actor, {
    action: "product.created",
    targetType: "product",
    targetId: product.id,
    targetLabel: `${product.sku} ${product.name}`,
    after: { sku, name, opening_stock: openingQty, warehouse_id: warehouseId || null },
  });

  revalidatePath("/products");
  revalidatePath("/inventory");
  redirect(`/products/${product.id}`);
}

export async function updateProductAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const actor = await requirePermission("products.edit");

  const productId = text(formData, "productId");
  const name = text(formData, "name");
  if (!productId) return { status: "error", message: "That product could not be found." };
  if (!name) return { status: "error", message: "Give the product a name." };

  const supabase = await createSupabaseServerClient();

  // Quantities are absent on purpose. Stock moves through the ledger, so
  // an edit form that could set it would be a second, competing truth.
  const { data, error } = await supabase
    .from("products")
    .update({
      name,
      description: text(formData, "description") || null,
      category_id: text(formData, "categoryId") || null,
      unit_of_measure: text(formData, "unit") || "each",
      units_per_case: Math.max(1, Math.trunc(number(formData, "unitsPerCase", 1))),
      cost_price: number(formData, "costPrice"),
      list_price: number(formData, "listPrice"),
      tax_rate: number(formData, "taxRate"),
      reorder_point: Math.trunc(number(formData, "reorderPoint")),
      reorder_qty: Math.trunc(number(formData, "reorderQty")),
      barcode: text(formData, "barcode") || null,
      is_active: formData.get("isActive") !== null,
    })
    .eq("id", productId)
    .select("id, sku, name")
    .maybeSingle();

  if (error || !data) {
    console.error("[catalogue] could not update product", error);
    return {
      status: "error",
      message: error
        ? toAppError(error).userMessage
        : "That product could not be found, or you do not have access to it.",
    };
  }

  await recordAudit(actor, {
    action: "product.updated",
    targetType: "product",
    targetId: productId,
    targetLabel: `${data.sku} ${data.name}`,
    after: { name },
  });

  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
  return { status: "done", message: "Product updated." };
}

export async function addStockAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const actor = await requirePermission("inventory.adjust");

  const productId = text(formData, "productId");
  const warehouseId = text(formData, "warehouseId");
  const quantity = Math.trunc(number(formData, "quantity"));

  if (!productId || !warehouseId) {
    return { status: "error", message: "Choose a product and a warehouse." };
  }
  if (quantity <= 0) {
    return { status: "error", message: "Enter how many units are being added." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_stock", {
    p_product_id: productId,
    p_warehouse_id: warehouseId,
    p_quantity: quantity,
    p_reason: text(formData, "reason") || null,
  });

  if (error) {
    console.error("[catalogue] could not add stock", error);
    return { status: "error", message: toAppError(error).userMessage };
  }

  await recordAudit(actor, {
    action: "stock.added",
    targetType: "product",
    targetId: productId,
    targetLabel: text(formData, "productLabel") || productId,
    after: { added: quantity, warehouse_id: warehouseId, reason: text(formData, "reason") },
  });

  revalidatePath(`/products/${productId}`);
  revalidatePath("/inventory");
  return { status: "done", message: `${quantity} added.` };
}

export async function adjustStockAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const actor = await requirePermission("inventory.adjust");

  const productId = text(formData, "productId");
  const warehouseId = text(formData, "warehouseId");
  const reason = text(formData, "reason");
  const newQuantity = Math.trunc(number(formData, "newQuantity", -1));

  if (!productId || !warehouseId) {
    return { status: "error", message: "Choose a product and a warehouse." };
  }
  if (newQuantity < 0) {
    return { status: "error", message: "Enter the quantity there should be." };
  }
  // The database refuses an unexplained adjustment too. Asking here means
  // the operator is told before they lose what they typed.
  if (!reason) {
    return { status: "error", message: "Say why the quantity is being corrected." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("adjust_stock_to", {
      p_product_id: productId,
      p_warehouse_id: warehouseId,
      p_new_quantity: newQuantity,
      p_reason: reason,
    })
    .maybeSingle();

  if (error) {
    console.error("[catalogue] could not adjust stock", error);
    return { status: "error", message: toAppError(error).userMessage };
  }

  const movement = data as { type?: string; quantity?: number } | null;

  await recordAudit(actor, {
    action: "stock.adjusted",
    targetType: "product",
    targetId: productId,
    targetLabel: text(formData, "productLabel") || productId,
    after: {
      corrected_to: newQuantity,
      movement: movement?.type ?? null,
      units: movement?.quantity ?? null,
      reason,
    },
  });

  revalidatePath(`/products/${productId}`);
  revalidatePath("/inventory");
  return {
    status: "done",
    message:
      movement?.type === "adjustment_out"
        ? `Corrected down by ${movement?.quantity}. The change is in the stock history.`
        : `Corrected up by ${movement?.quantity}. The change is in the stock history.`,
  };
}

export async function recordStocktakeAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const actor = await requirePermission("inventory.count");

  const warehouseId = text(formData, "warehouseId");
  if (!warehouseId) return { status: "error", message: "Choose the warehouse being counted." };

  // Only the lines the counter actually filled in. A blank box means
  // "not counted", which is not the same as counting zero.
  const counts: { product_id: string; counted: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("count.")) continue;
    const raw = String(value).trim();
    if (raw === "") continue;
    const counted = Math.trunc(Number(raw));
    if (!Number.isFinite(counted) || counted < 0) {
      return { status: "error", message: "A counted quantity cannot be negative." };
    }
    counts.push({ product_id: key.slice("count.".length), counted });
  }

  if (counts.length === 0) {
    return { status: "error", message: "Enter at least one counted quantity." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("record_stocktake", {
    p_warehouse_id: warehouseId,
    p_counts: counts,
    p_notes: text(formData, "notes") || null,
  });

  if (error) {
    console.error("[catalogue] could not record stock count", error);
    return { status: "error", message: toAppError(error).userMessage };
  }

  const posted = Number(data ?? 0);

  await recordAudit(actor, {
    action: "stock.counted",
    targetType: "warehouse",
    targetId: warehouseId,
    targetLabel: text(formData, "warehouseLabel") || warehouseId,
    after: { lines_counted: counts.length, lines_adjusted: posted },
  });

  revalidatePath("/inventory");
  return {
    status: "done",
    message:
      posted === 0
        ? `All ${counts.length} counted lines agreed with the system. Nothing to correct.`
        : `${posted} of ${counts.length} counted lines differed and have been corrected.`,
  };
}
