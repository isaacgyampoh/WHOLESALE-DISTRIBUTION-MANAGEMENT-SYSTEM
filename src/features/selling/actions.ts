"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/session";
import { toAppError } from "@/lib/errors/app-error";
import type { VanSaleType } from "@/types/domain";

/**
 * Completing a sale.
 *
 * The whole sale is one database call. record_sale() writes the header,
 * the lines, the stock movements and any credit charge inside a single
 * transaction, so there is no state in which a receipt exists but the
 * stock never left the van.
 *
 * What this action does NOT send: a van id, a warehouse id, or a
 * salesperson id. The database works those out from the session. A
 * forged request can change the customer and the quantities, both of
 * which are then checked, and nothing else.
 */

export interface SaleActionState {
  status: "idle" | "error";
  message?: string;
}

export const INITIAL_SALE_STATE: SaleActionState = { status: "idle" };

interface CartLine {
  product_id: string;
  quantity: number;
}

export async function recordSaleAction(
  _prev: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  await requirePermission("sales.create");

  const customerId = String(formData.get("customerId") ?? "").trim();
  if (!customerId) return { status: "error", message: "Choose a customer." };

  const saleType = (String(formData.get("saleType") ?? "cash") === "credit"
    ? "credit"
    : "cash") as VanSaleType;

  const items: CartLine[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("qty.")) continue;
    const quantity = Math.trunc(Number(String(value).trim() || "0"));
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    items.push({ product_id: key.slice("qty.".length), quantity });
  }

  if (items.length === 0) {
    return { status: "error", message: "Add at least one product to the sale." };
  }

  const amountPaidRaw = String(formData.get("amountPaid") ?? "").trim();
  const amountPaid = amountPaidRaw === "" ? null : Number(amountPaidRaw);
  if (amountPaid !== null && !Number.isFinite(amountPaid)) {
    return { status: "error", message: "Enter a valid amount received." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("record_sale", {
      p_customer_id: customerId,
      p_items: items,
      p_sale_type: saleType,
      // A cash sale defaults to paying the total; the database refuses a
      // cash sale that is short, so this is not a way around that.
      p_amount_paid: saleType === "credit" ? (amountPaid ?? 0) : amountPaid,
      p_warehouse_id: null,
      p_notes: String(formData.get("notes") ?? "").trim() || null,
    })
    .maybeSingle();

  if (error || !data) {
    console.error("[selling] sale refused", error);
    return { status: "error", message: toAppError(error).userMessage };
  }

  const sale = data as { id: string };

  revalidatePath("/sell");
  revalidatePath("/my-van");
  revalidatePath("/");
  redirect(`/sell/${sale.id}/receipt`);
}
