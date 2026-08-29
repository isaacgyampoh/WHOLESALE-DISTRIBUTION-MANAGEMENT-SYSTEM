"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { describeImageRefusal } from "@/lib/catalogue/image";
import { getCapabilities } from "@/lib/db/capabilities";
import { UNITS } from "@/lib/catalogue/units";
import {
  readQuantity, packSize, covers, isEmpty, formatHolding, holdsPieces, NOTHING,
} from "@/lib/catalogue/quantity";
import type { AuthenticatedUser } from "@/types/domain";
import { can } from "@/types/permissions";
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
    .select("id, sku, name, category_id, unit_of_measure, units_per_case, cost_price, list_price, reorder_point, reorder_qty, is_active, org_id, description, track_batches, track_expiry, shelf_life_days")
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

/**
 * The pack size, validated.
 *
 * Blank means 1 rather than an error: the field is prefilled and a
 * person clearing it means "not split", not "reject my form". The
 * ceiling is arbitrary but a carton of ten thousand pieces is a typo,
 * and typos here quietly multiply every conversion that follows.
 */
/**
 * Loose pieces of one product, anywhere they are held - warehouses and
 * vans both. Zero against a database before 0048, where there is no
 * such column and therefore no loose pieces to strand.
 */
async function loosePiecesHeld(productId: string): Promise<number> {
  const capabilities = await getCapabilities();
  if (!capabilities.loosePieces) return 0;

  const admin = createSupabaseAdminClient();
  const [shelves, vans] = await Promise.all([
    admin.from("inventory").select("qty_pieces").eq("product_id", productId),
    admin.from("van_inventory").select("qty_pieces").eq("product_id", productId),
  ]);

  const total = (rows: { qty_pieces: number | null }[] | null) =>
    (rows ?? []).reduce((sum, r) => sum + Number(r.qty_pieces ?? 0), 0);

  return total(shelves.data) + total(vans.data);
}

/**
 * The price of one loose piece, or null where nobody has set one.
 *
 * Optional on purpose: most products are never split, and forcing a
 * figure for them would be a field nobody can answer. Null is what the
 * till reads as "fall back to the pack rate".
 */
function readPiecePrice(raw: string, errors: Record<string, string>): number | null {
  const text = raw.trim();
  if (text === "") return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) {
    errors.piecePrice = "Use an amount like 6 or 6.50.";
    return null;
  }
  return Number(text);
}

function readPackSize(raw: string, errors: Record<string, string>): number {
  const text = raw.trim();
  if (text === "") return 1;
  if (!/^\d{1,5}$/.test(text)) {
    errors.piecesPerUnit = "Enter a whole number, 1 or more.";
    return 1;
  }
  const size = Number(text);
  if (size < 1) {
    errors.piecesPerUnit = "Enter a whole number, 1 or more.";
    return 1;
  }
  if (size > 10000) {
    errors.piecesPerUnit = "That is over ten thousand pieces. Check the figure.";
    return 1;
  }
  return size;
}

function productFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    sku: String(formData.get("sku") ?? "").trim().toUpperCase(),
    categoryId: String(formData.get("categoryId") ?? ""),
    unit: String(formData.get("unit") ?? "piece"),
    costPrice: String(formData.get("costPrice") ?? ""),
    listPrice: String(formData.get("listPrice") ?? ""),
    piecePrice: String(formData.get("piecePrice") ?? "").trim(),
    reorderPoint: String(formData.get("reorderPoint") ?? "0"),
    reorderQty: String(formData.get("reorderQty") ?? "0"),
    trackBatches: formData.get("trackBatches") === "on" ? "on" : "",
    trackExpiry: formData.get("trackExpiry") === "on" ? "on" : "",
    shelfLifeDays: String(formData.get("shelfLifeDays") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    isActive: String(formData.get("isActive") ?? "true"),
    // Opening stock, on creation only. What is already on the shelf the
    // day this product is first written down.
    openingQty: String(formData.get("openingQty") ?? "").trim(),
    openingPieces: String(formData.get("openingPieces") ?? "").trim(),
    openingWarehouseId: String(formData.get("openingWarehouseId") ?? ""),
    // How many single pieces come out of one whole unit. 1 means this
    // product is never split, which is true of most of them.
    piecesPerUnit: String(formData.get("piecesPerUnit") ?? "1").trim(),
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

  // Opening stock is optional - a product can be listed before any of it
  // arrives - but a quantity without somewhere to put it is not a fact
  // anyone can act on.
  const openingQty = v.openingQty
    ? readWholeNumber(v.openingQty, "openingQty", errors)
    : null;
  if (openingQty !== null && openingQty < 0) {
    errors.openingQty = "Enter a quantity of zero or more.";
  }
  // Loose pieces are their own figure. A shelf can hold nothing but
  // singles - a carton somebody opened last month - so this stands on
  // its own rather than depending on whole units being entered.
  const openingPieces = v.openingPieces
    ? readWholeNumber(v.openingPieces, "openingPieces", errors)
    : null;
  if (openingPieces !== null && openingPieces < 0) {
    errors.openingPieces = "Enter a quantity of zero or more.";
  }

  const packSize = readPackSize(v.piecesPerUnit, errors);
  const piecePrice = readPiecePrice(v.piecePrice, errors);
  const capabilitiesForWrite = await getCapabilities();

  // A price for a piece of something nobody has said can be split is a
  // figure that could never be charged.
  if (piecePrice !== null && packSize <= 1) {
    errors.piecePrice =
      "Say how many pieces come out of one unit before pricing a single one.";
  }
  // Loose pieces without a pack size means nobody has said what a piece
  // is. The number would be recorded and no screen could ever relate it
  // to the cartons beside it.
  if (openingPieces !== null && openingPieces > 0 && packSize <= 1) {
    errors.piecesPerUnit =
      "Say how many pieces come out of one unit before entering loose ones.";
  }

  const opensWithStock = (openingQty ?? 0) > 0 || (openingPieces ?? 0) > 0;
  if (opensWithStock && !v.openingWarehouseId) {
    errors.openingWarehouseId = "Choose where this stock is held.";
  }
  // Putting stock somewhere is a stock movement, and not everyone who
  // may add a product may make one.
  if (opensWithStock && !can(actor.role, "inventory.adjust")) {
    errors.openingQty = "You can add the product, but not its stock. Ask a manager to enter it.";
  }

  if (Object.keys(errors).length) {
    return { status: "error", message: "Check the fields below.", values: v, fieldErrors: errors };
  }

  const admin = createSupabaseAdminClient();

  if (opensWithStock) {
    const { data: warehouse } = await admin
      .from("warehouses").select("id, org_id").eq("id", v.openingWarehouseId).maybeSingle();
    if (!warehouse || warehouse.org_id !== actor.organizationId) {
      return {
        status: "error", message: "Check the fields below.", values: v,
        fieldErrors: { openingWarehouseId: "Choose a warehouse." },
      };
    }
  }

  const { data, error } = await admin
    .from("products")
    .insert({
      org_id: actor.organizationId,
      sku: v.sku,
      name: v.name,
      description: v.description || null,
      category_id: categoryId,
      unit_of_measure: v.unit,
      units_per_case: packSize,
      cost_price: cost,
      list_price: list,
      ...(capabilitiesForWrite.loosePieces ? { piece_price: piecePrice } : {}),
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

  // The opening stock, as a movement on the existing ledger.
  //
  // Not a quantity written onto the product: nothing else in this system
  // believes such a column, and a second place that claims to know the
  // stock level is a second place that can be wrong. The trigger on
  // stock_movements does the arithmetic, the same way a receipt or a
  // count does.
  //
  // Deliberately after the insert, and deliberately not fatal. A product
  // that exists with no stock is a five-second fix from its own page; a
  // product that vanished because its opening stock failed is a mystery.
  let openingStockMessage = "";
  if (opensWithStock) {
    const capabilities = await getCapabilities();
    const { error: stockError } = await admin.from("stock_movements").insert({
      org_id: actor.organizationId,
      product_id: data.id as string,
      warehouse_id: v.openingWarehouseId,
      type: "opening_stock",
      quantity: openingQty ?? 0,
      // Omitted entirely against a database before 0048, where the
      // column does not exist. Nobody can have entered loose pieces
      // there either - the form's own figure is gated on a pack size
      // that schema cannot hold - so nothing is lost by leaving it out.
      ...(capabilities.loosePieces ? { pieces: openingPieces ?? 0 } : {}),
      reason: "Opening stock",
      reference_type: "opening_stock",
      created_by: actor.id,
    });

    if (stockError) {
      console.error("[catalogue] opening stock failed", stockError);
      openingStockMessage =
        " The product was saved, but its opening stock was not - add it from the product page.";
    } else {
      await recordAudit(actor, {
        action: "stock.adjusted",
        targetType: "product",
        targetId: data.id as string,
        targetLabel: `${v.sku} ${v.name}`,
        after: {
          via: "opening_stock",
          quantity: openingQty ?? 0,
          pieces: openingPieces ?? 0,
          warehouse: v.openingWarehouseId,
        },
      });
    }
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
  return {
    status: "done",
    message: `Product created.${openingStockMessage}`,
    createdId: data.id as string,
  };
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

  const packSize = readPackSize(v.piecesPerUnit, errors);
  const piecePrice = readPiecePrice(v.piecePrice, errors);
  const capabilitiesForWrite = await getCapabilities();

  if (piecePrice !== null && !holdsPieces(v.unit)) {
    errors.piecePrice =
      "This product is sold by the piece, so its selling price is already the piece price.";
  }

  // Changing a product to be sold by the piece is what would strand
  // loose stock: the two quantities collapse into one and there is
  // nowhere left to describe the singles. Clearing the pack size does
  // not - that only means boxes can no longer be opened, which is a
  // separate thing from holding singles that are already open.
  if (!holdsPieces(v.unit) && holdsPieces(existing.unit_of_measure as string)) {
    const loose = await loosePiecesHeld(id);
    if (loose > 0) {
      errors.unit =
        `There are ${loose} loose pieces of this product. Sell them or pack them up ` +
        `before making it a piece-only product.`;
    }
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
      units_per_case: packSize,
      cost_price: cost,
      list_price: list,
      ...(capabilitiesForWrite.loosePieces ? { piece_price: piecePrice } : {}),
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
  const piecesRaw = String(formData.get("pieces") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const values = { direction, quantity: quantityRaw, pieces: piecesRaw, reason, warehouseId };
  const errors: Record<string, string> = {};

  const product = await ownedProduct(actor, productId);
  if (!product) return { status: "error", message: "That product could not be found." };

  if (!(await categoryAllowed(actor, product.category_id as string | null))) {
    return { status: "error", message: "You can only adjust products in categories you manage." };
  }

  const capabilities = await getCapabilities();
  const pack = packSize(Number(product.units_per_case ?? 1));
  const unit = String(product.unit_of_measure ?? "unit");

  // Both halves, read together. Either may be blank; the movement as a
  // whole may not be empty, which is the rule the database enforces too.
  const read = readQuantity(quantityRaw, capabilities.loosePieces ? piecesRaw : "");
  if (!read.ok) {
    errors[read.field === "units" ? "quantity" : "pieces"] = read.message;
  }
  const moving = read.ok ? read.value : NOTHING;

  if (read.ok && isEmpty(moving)) {
    errors.quantity = "Enter a quantity above zero.";
  }
  // A piece needs a parent unit to be loose from. Pack size is not the
  // question: it governs opening a box, not holding singles.
  if (moving.pieces > 0 && !holdsPieces(unit)) {
    errors.pieces = "This product is sold by the piece, so it has no separate loose half.";
  }
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

  // Taking stock out cannot leave a negative balance - in either half,
  // and each judged on its own. Two sealed cartons do not cover a
  // request for three loose pieces, because until one is opened the
  // pieces are not there.
  if (direction === "out") {
    const { data: level } = await admin
      .from("inventory")
      .select(capabilities.loosePieces ? "qty_on_hand, qty_pieces" : "qty_on_hand")
      .eq("product_id", productId).eq("warehouse_id", warehouseId).maybeSingle();

    const held = {
      units: Number((level as { qty_on_hand?: number } | null)?.qty_on_hand ?? 0),
      pieces: Number((level as { qty_pieces?: number } | null)?.qty_pieces ?? 0),
    };

    if (!covers(held, moving)) {
      const fieldErrors: Record<string, string> = {};
      if (moving.units > held.units) {
        fieldErrors.quantity = `Only ${formatHolding({ units: held.units, pieces: 0 }, unit)} at ${warehouse.name}.`;
      }
      if (moving.pieces > held.pieces) {
        fieldErrors.pieces = `Only ${held.pieces} loose pieces at ${warehouse.name}.` +
          (held.units > 0 && pack !== null
            ? " Open a full one first if you need more."
            : "");
      }
      return { status: "error", message: "Check the fields below.", values, fieldErrors };
    }
  }

  // The movement is the record. Quantities follow from it.
  const { error } = await admin.from("stock_movements").insert({
    org_id: actor.organizationId,
    product_id: productId,
    warehouse_id: warehouseId,
    type: direction === "out" ? "adjustment_out" : "adjustment_in",
    quantity: moving.units,
    ...(capabilities.loosePieces ? { pieces: moving.pieces } : {}),
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
      quantity: moving.units,
      pieces: moving.pieces,
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

// ===================================================================
// Opening a carton, and packing one back up
// ===================================================================
//
// The one way stock crosses between full units and loose pieces.
//
// It is a server action rather than arithmetic on a screen because it
// is a physical act: somebody cut the tape, and afterwards the shelf
// holds one fewer carton and twelve more singles. A system that did
// this quietly whenever a piece was needed would be inventing stock,
// and the discrepancy would surface at stocktake with nothing in the
// ledger to explain it.
//
// The database function does the work and holds the rules - the role
// check, the pack size, whether there is enough to open. This reads the
// form, calls it, and turns a refusal into a sentence.

export async function convertStockUnitsAction(
  _prev: CatalogueState,
  formData: FormData,
): Promise<CatalogueState> {
  const actor = await requirePermission("inventory.adjust");

  const productId = String(formData.get("productId") ?? "");
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const action = String(formData.get("action") ?? "open");
  const unitsRaw = String(formData.get("units") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const values = { action, units: unitsRaw, reason, warehouseId };
  const errors: Record<string, string> = {};

  const product = await ownedProduct(actor, productId);
  if (!product) return { status: "error", message: "That product could not be found." };

  if (!(await categoryAllowed(actor, product.category_id as string | null))) {
    return { status: "error", message: "You can only change products in categories you manage." };
  }

  const capabilities = await getCapabilities();
  if (!capabilities.loosePieces) {
    return {
      status: "error",
      message: "This database does not record loose pieces yet. Apply the pending upgrade first.",
      values,
    };
  }

  const units = readWholeNumber(unitsRaw, "units", errors);
  if (units !== null && units <= 0) errors.units = "Enter a number above zero.";
  if (!reason) errors.reason = "Say why the stock is changing.";
  if (!warehouseId) errors.warehouseId = "Choose a warehouse.";
  if (action !== "open" && action !== "pack") {
    errors.action = "Choose whether to open or pack up.";
  }

  if (Object.keys(errors).length) {
    return { status: "error", message: "Check the fields below.", values, fieldErrors: errors };
  }

  const admin = createSupabaseAdminClient();
  const { data: warehouse } = await admin
    .from("warehouses").select("id, org_id, name").eq("id", warehouseId).maybeSingle();
  if (!warehouse || warehouse.org_id !== actor.organizationId) {
    return { status: "error", message: "That warehouse could not be found." };
  }

  const { error } = await admin.rpc("convert_stock_units", {
    p_product: productId,
    p_warehouse: warehouseId,
    p_van: null,
    p_action: action,
    p_units: units,
    p_reason: reason,
  });

  if (error) {
    console.error("[catalogue] unit conversion failed", error);
    // The function refuses by name - "Only 3 cartons there, 5 asked to
    // be opened" - and that sentence is more use to whoever is standing
    // at the shelf than anything this layer could invent.
    return {
      status: "error",
      message: error.message || "The change could not be saved. Please try again.",
      values,
    };
  }

  await recordAudit(actor, {
    action: "stock.adjusted",
    targetType: "product",
    targetId: productId,
    targetLabel: `${product.sku} ${product.name}`,
    after: {
      via: action === "open" ? "unit_opened" : "unit_packed",
      units,
      pack_size: Number(product.units_per_case ?? 1),
      warehouse: warehouse.name,
      reason,
    },
  });

  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);

  return {
    status: "done",
    message: action === "open" ? "Opened." : "Packed up.",
  };
}
