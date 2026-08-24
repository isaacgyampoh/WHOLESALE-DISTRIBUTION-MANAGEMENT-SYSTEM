"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { describeImageRefusal } from "@/lib/catalogue/image";
import { getCapabilities } from "@/lib/db/capabilities";
import { UNITS } from "@/lib/catalogue/units";
import type { AuthenticatedUser } from "@/types/domain";
import type { CatalogueState } from "./state";

/**
 * Catalogue and stock changes.
 *
 * Every action re-checks its permission on the server, confirms the
 * record belongs to the caller's organization, and records what changed.
 * A hidden button is a courtesy; this is the control.
 *
 * Stock is never written here. It is derived from the append-only
 * ledger, so an adjustment posts a movement and lets the database
 * arrive at the new quantity.
 */

const MONEY = /^\d{1,9}(\.\d{1,2})?$/;

function readMoney(value: string, field: string, errors: Record<string, string>): number | null {
  const trimmed = value.trim();
  if (!trimmed) { errors[field] = "Enter an amount."; return null; }
  if (!MONEY.test(trimmed)) {
    errors[field] = "Use a number with at most two decimal places.";
    return null;
  }
  const amount = Number(trimmed);
  if (amount < 0) { errors[field] = "An amount cannot be negative."; return null; }
  return amount;
}

function readWholeNumber(value: string, field: string, errors: Record<string, string>): number | null {
  const trimmed = value.trim() || "0";
  if (!/^\d{1,9}$/.test(trimmed)) {
    // Stock is held as whole units, so a fraction is rejected rather
    // than quietly rounded.
    errors[field] = "Use a whole number.";
    return null;
  }
  return Number(trimmed);
}

async function ownedProduct(actor: AuthenticatedUser, id: string) {
  if (!id) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("products")
    .select("id, sku, name, category_id, unit_of_measure, cost_price, list_price, reorder_point, reorder_qty, is_active, org_id, description, track_batches, track_expiry, shelf_life_days")
    .eq("id", id)
    .maybeSingle();
  return data && data.org_id === actor.organizationId ? data : null;
}

async function ownedCategory(actor: AuthenticatedUser, id: string) {
  if (!id) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("categories").select("id, name, description, is_active, org_id").eq("id", id).maybeSingle();
  return data && data.org_id === actor.organizationId ? data : null;
}

/**
 * A manager may only touch products in categories they hold. Checked
 * here for a clear message; row level security refuses regardless.
 */
async function categoryAllowed(actor: AuthenticatedUser, categoryId: string | null): Promise<boolean> {
  if (actor.role !== "manager") return true;
  if (!categoryId) return false;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("manager_category_scopes")
    .select("category_id")
    .eq("profile_id", actor.id)
    .eq("category_id", categoryId)
    .maybeSingle();
  return Boolean(data);
}

function productFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    sku: String(formData.get("sku") ?? "").trim().toUpperCase(),
    categoryId: String(formData.get("categoryId") ?? ""),
    unit: String(formData.get("unit") ?? "piece"),
    costPrice: String(formData.get("costPrice") ?? ""),
    listPrice: String(formData.get("listPrice") ?? ""),
    reorderPoint: String(formData.get("reorderPoint") ?? "0"),
    reorderQty: String(formData.get("reorderQty") ?? "0"),
    trackBatches: formData.get("trackBatches") === "on" ? "on" : "",
    trackExpiry: formData.get("trackExpiry") === "on" ? "on" : "",
    shelfLifeDays: String(formData.get("shelfLifeDays") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    isActive: String(formData.get("isActive") ?? "true"),
  };
}

export async function createProductAction(
  _prev: CatalogueState,
  formData: FormData,
): Promise<CatalogueState> {
  const actor = await requirePermission("products.create");
  const v = productFields(formData);
  const errors: Record<string, string> = {};

  if (!v.name) errors.name = "Enter a product name.";
  if (!v.sku) errors.sku = "Enter a product code.";
  else if (!/^[A-Z0-9][A-Z0-9._-]{1,31}$/.test(v.sku)) {
    errors.sku = "Use letters, digits, dots, dashes or underscores.";
  }
  if (!UNITS.includes(v.unit as never)) errors.unit = "Choose a unit.";

  const cost = readMoney(v.costPrice, "costPrice", errors);
  const list = readMoney(v.listPrice, "listPrice", errors);
  const reorderPoint = readWholeNumber(v.reorderPoint, "reorderPoint", errors);
  const reorderQty = readWholeNumber(v.reorderQty, "reorderQty", errors);
  if (v.shelfLifeDays && !/^\d{1,4}$/.test(v.shelfLifeDays)) {
    errors.shelfLifeDays = "Use a whole number of days, or leave it blank.";
  } else if (v.shelfLifeDays && Number(v.shelfLifeDays) > 3650) {
    errors.shelfLifeDays = "That is over ten years. Check the figure.";
  }

  const categoryId = v.categoryId || null;
  if (categoryId && !(await ownedCategory(actor, categoryId))) {
    errors.categoryId = "Choose a category.";
  }
  if (!(await categoryAllowed(actor, categoryId))) {
    errors.categoryId = "You can only add products to categories you manage.";
  }

  if (Object.keys(errors).length) {
    return { status: "error", message: "Check the fields below.", values: v, fieldErrors: errors };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("products")
    .insert({
      org_id: actor.organizationId,
      sku: v.sku,
      name: v.name,
      description: v.description || null,
      category_id: categoryId,
      unit_of_measure: v.unit,
      cost_price: cost,
      list_price: list,
      reorder_point: reorderPoint,
      reorder_qty: reorderQty,
      // Expiry has nowhere to live without a batch, so asking for one
      // implies the other. The database says the same; this keeps the
      // form from having to explain it.
      track_batches: v.trackBatches === "on" || v.trackExpiry === "on",
      track_expiry: v.trackExpiry === "on",
      shelf_life_days: v.shelfLifeDays ? Number(v.shelfLifeDays) : null,
      is_active: v.isActive === "true",
      created_by: actor.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        message: "Check the fields below.",
        values: v,
        fieldErrors: { sku: "A product with this code already exists." },
      };
    }
    console.error("[catalogue] product create failed", error);
    return { status: "error", message: "The product could not be saved. Please try again.", values: v };
  }

  await recordAudit(actor, {
    action: "product.created",
    targetType: "product",
    targetId: data.id as string,
    targetLabel: `${v.sku} ${v.name}`,
    after: { sku: v.sku, name: v.name, cost_price: cost, list_price: list },
  });

  revalidatePath("/products");
  revalidatePath("/inventory");
  return { status: "done", message: "Product created.", createdId: data.id as string };
}

export async function updateProductAction(
  _prev: CatalogueState,
  formData: FormData,
): Promise<CatalogueState> {
  const actor = await requirePermission("products.edit");
  const id = String(formData.get("productId") ?? "");
  const v = productFields(formData);
  const errors: Record<string, string> = {};

  const existing = await ownedProduct(actor, id);
  if (!existing) return { status: "error", message: "That product could not be found." };

  if (!v.name) errors.name = "Enter a product name.";
  if (!UNITS.includes(v.unit as never)) errors.unit = "Choose a unit.";

  const cost = readMoney(v.costPrice, "costPrice", errors);
  const list = readMoney(v.listPrice, "listPrice", errors);
  const reorderPoint = readWholeNumber(v.reorderPoint, "reorderPoint", errors);
  const reorderQty = readWholeNumber(v.reorderQty, "reorderQty", errors);
  if (v.shelfLifeDays && !/^\d{1,4}$/.test(v.shelfLifeDays)) {
    errors.shelfLifeDays = "Use a whole number of days, or leave it blank.";
  } else if (v.shelfLifeDays && Number(v.shelfLifeDays) > 3650) {
    errors.shelfLifeDays = "That is over ten years. Check the figure.";
  }

  const categoryId = v.categoryId || null;
  if (!(await categoryAllowed(actor, categoryId)) ||
      !(await categoryAllowed(actor, (existing.category_id as string | null)))) {
    errors.categoryId = "You can only manage products in categories you manage.";
  }

  if (Object.keys(errors).length) {
    return { status: "error", message: "Check the fields below.", values: v, fieldErrors: errors };
  }

  const admin = createSupabaseAdminClient();
  // Deliberately not touching quantities: editing a price or a name must
  // never move stock. Stock changes go through an adjustment, which
  // posts a movement and says why.
  const { error } = await admin
    .from("products")
    .update({
      name: v.name,
      description: v.description || null,
      category_id: categoryId,
      unit_of_measure: v.unit,
      cost_price: cost,
      list_price: list,
      reorder_point: reorderPoint,
      reorder_qty: reorderQty,
      // Expiry has nowhere to live without a batch, so asking for one
      // implies the other. The database says the same; this keeps the
      // form from having to explain it.
      track_batches: v.trackBatches === "on" || v.trackExpiry === "on",
      track_expiry: v.trackExpiry === "on",
      shelf_life_days: v.shelfLifeDays ? Number(v.shelfLifeDays) : null,
      is_active: v.isActive === "true",
    })
    .eq("id", id);

  if (error) {
    console.error("[catalogue] product update failed", error);
    return { status: "error", message: "The change could not be saved. Please try again.", values: v };
  }

  const wasActive = existing.is_active as boolean;
  const nowActive = v.isActive === "true";

  await recordAudit(actor, {
    action: wasActive === nowActive
      ? "product.updated"
      : nowActive ? "product.activated" : "product.deactivated",
    targetType: "product",
    targetId: id,
    targetLabel: `${existing.sku} ${existing.name}`,
    before: {
      name: existing.name,
      cost_price: Number(existing.cost_price),
      list_price: Number(existing.list_price),
      reorder_point: existing.reorder_point,
      is_active: wasActive,
    },
    after: {
      name: v.name, cost_price: cost, list_price: list,
      reorder_point: reorderPoint, is_active: nowActive,
    },
  });

  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
  revalidatePath("/inventory");
  return { status: "done", message: "Product updated." };
}

export async function saveCategoryAction(
  _prev: CatalogueState,
  formData: FormData,
): Promise<CatalogueState> {
  // Category maintenance shapes what every manager can reach, so it sits
  // with product editing rather than with product creation.
  const actor = await requirePermission("products.edit");

  const id = String(formData.get("categoryId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const isActive = String(formData.get("isActive") ?? "true") === "true";
  const values = { name, description, isActive: String(isActive) };

  if (!name) {
    return {
      status: "error", message: "Check the fields below.", values,
      fieldErrors: { name: "Enter a category name." },
    };
  }

  const admin = createSupabaseAdminClient();
  const existing = id ? await ownedCategory(actor, id) : null;
  if (id && !existing) return { status: "error", message: "That category could not be found." };

  const payload = { name, description: description || null, is_active: isActive };
  const { error } = existing
    ? await admin.from("categories").update(payload).eq("id", id)
    : await admin.from("categories").insert({ ...payload, org_id: actor.organizationId });

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error", message: "Check the fields below.", values,
        fieldErrors: { name: "A category with this name already exists." },
      };
    }
    console.error("[catalogue] category save failed", error);
    return { status: "error", message: "The category could not be saved. Please try again.", values };
  }

  await recordAudit(actor, {
    action: existing
      ? (existing.is_active === isActive
          ? "category.updated"
          : isActive ? "category.activated" : "category.deactivated")
      : "category.created",
    targetType: "category",
    targetId: id || undefined,
    targetLabel: name,
    before: existing ? { name: existing.name, is_active: existing.is_active } : undefined,
    after: { name, is_active: isActive },
  });

  revalidatePath("/categories");
  revalidatePath("/products");
  return { status: "done", message: existing ? "Category updated." : "Category created." };
}

export async function adjustStockAction(
  _prev: CatalogueState,
  formData: FormData,
): Promise<CatalogueState> {
  const actor = await requirePermission("inventory.adjust");

  const productId = String(formData.get("productId") ?? "");
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const direction = String(formData.get("direction") ?? "in");
  const quantityRaw = String(formData.get("quantity") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const values = { direction, quantity: quantityRaw, reason, warehouseId };
  const errors: Record<string, string> = {};

  const product = await ownedProduct(actor, productId);
  if (!product) return { status: "error", message: "That product could not be found." };

  if (!(await categoryAllowed(actor, product.category_id as string | null))) {
    return { status: "error", message: "You can only adjust products in categories you manage." };
  }

  const quantity = readWholeNumber(quantityRaw, "quantity", errors);
  if (quantity !== null && quantity <= 0) errors.quantity = "Enter a quantity above zero.";
  // A movement without a reason is an unexplained change, which is the
  // one thing an audited ledger must not contain.
  if (!reason) errors.reason = "Say why the stock is changing.";
  if (!warehouseId) errors.warehouseId = "Choose a warehouse.";

  if (Object.keys(errors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors: errors };
  }

  const admin = createSupabaseAdminClient();
  const { data: warehouse } = await admin
    .from("warehouses").select("id, org_id, name").eq("id", warehouseId).maybeSingle();
  if (!warehouse || warehouse.org_id !== actor.organizationId) {
    return { status: "error", message: "That warehouse could not be found." };
  }

  // Taking stock out cannot leave a negative balance.
  if (direction === "out") {
    const { data: level } = await admin
      .from("inventory").select("qty_on_hand")
      .eq("product_id", productId).eq("warehouse_id", warehouseId).maybeSingle();
    const onHand = Number(level?.qty_on_hand ?? 0);
    if (quantity! > onHand) {
      return {
        status: "error", message: "Check the fields below.", values,
        fieldErrors: {
          quantity: `Only ${onHand} in stock at ${warehouse.name}.`,
        },
      };
    }
  }

  // The movement is the record. Quantities follow from it.
  const { error } = await admin.from("stock_movements").insert({
    org_id: actor.organizationId,
    product_id: productId,
    warehouse_id: warehouseId,
    type: direction === "out" ? "adjustment_out" : "adjustment_in",
    quantity,
    reason,
    reference_type: "manual_adjustment",
    created_by: actor.id,
  });

  if (error) {
    console.error("[catalogue] adjustment failed", error);
    return { status: "error", message: "The adjustment could not be saved. Please try again.", values };
  }

  await recordAudit(actor, {
    action: "stock.adjusted",
    targetType: "product",
    targetId: productId,
    targetLabel: `${product.sku} ${product.name}`,
    after: {
      direction: direction === "out" ? "decrease" : "increase",
      quantity,
      warehouse: warehouse.name,
      reason,
    },
  });

  revalidatePath("/inventory");
  revalidatePath(`/products/${productId}`);
  return { status: "done", message: "Stock adjusted." };
}

// ===================================================================
// A photograph of the product
// ===================================================================
//
// Uploaded through a server action rather than straight from the
// browser to Storage. The browser holds only the anon key, and while
// the bucket's policies would refuse an unauthorised write anyway, the
// file is checked here first: type, size, and that the product is one
// of ours. A refusal with a sentence beats a 403 with none.

export async function uploadProductImageAction(
  _prev: CatalogueState,
  formData: FormData,
): Promise<CatalogueState> {
  const actor = await requirePermission("products.edit");

  if (!(await getCapabilities()).productImages) {
    return {
      status: "error",
      message:
        "Product pictures need database upgrade 0037. " +
        "Run database/UPGRADE_0037_PRODUCT_IMAGES.sql, then reload.",
    };
  }

  const productId = String(formData.get("productId") ?? "");
  const file = formData.get("image");

  if (!productId) return { status: "error", message: "That product could not be found." };
  if (!(file instanceof File) || file.size === 0) {
    return {
      status: "error",
      message: "Choose a picture.",
      fieldErrors: { image: "Choose a JPEG, PNG or WebP." },
    };
  }

  const refusal = describeImageRefusal({ type: file.type, size: file.size });
  if (refusal) {
    return { status: "error", message: refusal, fieldErrors: { image: refusal } };
  }

  const admin = createSupabaseAdminClient();
  const { data: product } = await admin
    .from("products").select("id, sku, name, org_id, image_path")
    .eq("id", productId).maybeSingle();

  if (!product || product.org_id !== actor.organizationId) {
    return { status: "error", message: "That product could not be found." };
  }

  // Named by product and organization, with a timestamp so replacing a
  // picture does not leave the old one cached under the same URL.
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${actor.organizationId}/${productId}/${Date.now()}.${extension}`;

  const { error: uploadError } = await admin.storage
    .from("product-images")
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error("[catalogue] product image upload failed", uploadError);
    return { status: "error", message: "The picture could not be stored. Please try again." };
  }

  const { error } = await admin
    .from("products").update({ image_path: path }).eq("id", productId);

  if (error) {
    console.error("[catalogue] product image could not be attached", error);
    // The file is up but unreferenced. Remove it rather than leave an
    // orphan nothing points at.
    await admin.storage.from("product-images").remove([path]);
    return { status: "error", message: "The picture could not be attached. Please try again." };
  }

  // The one it replaced. Left until now so a failure above did not
  // destroy the picture that was working.
  const previous = product.image_path as string | null;
  if (previous && previous !== path && !/^https?:\/\//i.test(previous)) {
    await admin.storage.from("product-images").remove([previous]);
  }

  await recordAudit(actor, {
    action: "product.updated",
    targetType: "product",
    targetId: productId,
    targetLabel: `${product.sku} ${product.name}`,
    after: { image: "replaced" },
  });

  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  revalidatePath("/driver/sell");

  return { status: "done", message: `Picture set for ${product.name}.` };
}

export async function removeProductImageAction(
  _prev: CatalogueState,
  formData: FormData,
): Promise<CatalogueState> {
  const actor = await requirePermission("products.edit");

  const productId = String(formData.get("productId") ?? "");
  if (!productId) return { status: "error", message: "That product could not be found." };

  const admin = createSupabaseAdminClient();
  const { data: product } = await admin
    .from("products").select("id, name, org_id, image_path")
    .eq("id", productId).maybeSingle();

  if (!product || product.org_id !== actor.organizationId) {
    return { status: "error", message: "That product could not be found." };
  }

  const { error } = await admin
    .from("products").update({ image_path: null }).eq("id", productId);

  if (error) {
    console.error("[catalogue] product image could not be removed", error);
    return { status: "error", message: "The picture could not be removed. Please try again." };
  }

  const path = product.image_path as string | null;
  if (path && !/^https?:\/\//i.test(path)) {
    await admin.storage.from("product-images").remove([path]);
  }

  await recordAudit(actor, {
    action: "product.updated",
    targetType: "product",
    targetId: productId,
    targetLabel: product.name as string,
    after: { image: "removed" },
  });

  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  revalidatePath("/driver/sell");

  return { status: "done", message: "Picture removed." };
}
