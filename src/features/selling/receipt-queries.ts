import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";

/**
 * A receipt is read back through the same row level security as
 * everything else: the salesperson who made the sale, the crew of the
 * van it left, and management. A sale id from elsewhere returns nothing.
 */

export interface ReceiptLine {
  productName: string;
  sku: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Receipt {
  saleId: string;
  saleNumber: string;
  saleType: string;
  status: string;
  soldAt: string;
  customerName: string;
  salespersonName: string | null;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balance: number;
  dueDate: string | null;
  lines: ReceiptLine[];
  organizationName: string;
}

export async function getReceipt(saleId: string): Promise<Receipt | null> {
  const supabase = await createSupabaseServerClient();

  const { data: sale } = await supabase
    .from("van_sales")
    .select("id, sale_number, sale_type, status, sold_at, subtotal, tax_total, total, amount_paid, balance, due_date, org_id, customers!van_sales_customer_id_fkey(name), profiles!van_sales_salesperson_id_fkey(full_name)")
    .eq("id", saleId)
    .maybeSingle();

  if (!sale) return null;

  const [lines, org] = await Promise.all([
    supabase
      .from("sale_lines")
      .select("product_name, sku, unit_of_measure, quantity, unit_price, line_total")
      .eq("sale_id", saleId),
    supabase.from("organizations").select("name").eq("id", sale.org_id as string).maybeSingle(),
  ]);

  return {
    saleId: sale.id as string,
    saleNumber: sale.sale_number as string,
    saleType: sale.sale_type as string,
    status: sale.status as string,
    soldAt: sale.sold_at as string,
    customerName: name(sale.customers) ?? "Walk-in customer",
    salespersonName: name(sale.profiles, "full_name"),
    subtotal: parseAmount(sale.subtotal),
    taxTotal: parseAmount(sale.tax_total),
    total: parseAmount(sale.total),
    amountPaid: parseAmount(sale.amount_paid),
    balance: parseAmount(sale.balance),
    dueDate: (sale.due_date as string | null) ?? null,
    organizationName: (org.data?.name as string) ?? "GAB Premium Ent",
    lines: (lines.data ?? []).map((l) => ({
      productName: l.product_name as string,
      sku: l.sku as string,
      unit: (l.unit_of_measure as string) ?? "each",
      quantity: Number(l.quantity ?? 0),
      unitPrice: parseAmount(l.unit_price),
      lineTotal: parseAmount(l.line_total),
    })),
  };
}

function name(value: unknown, key = "name"): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const v = (row as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}
