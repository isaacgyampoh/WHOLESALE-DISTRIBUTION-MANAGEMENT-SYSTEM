import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";
import { getCapabilities } from "@/lib/db/capabilities";
import { type Result, failed } from "@/lib/query/result";

/**
 * Invoices, receipts and waybills.
 *
 * These are documents rather than screens: each one is a thing a
 * customer or a driver ends up holding, so what is read here is exactly
 * what gets printed. Nothing is recomputed - the totals come from the
 * row the database wrote when the sale completed, because a figure
 * recalculated at print time can disagree with the one already given to
 * the customer.
 *
 * None of these queries asks for cost price. A customer document shows
 * what they were charged.
 */

export const PAGE_SIZE = 25;

/** Everything here needs migration 0026; without it the screens say so. */
async function requireDocuments(): Promise<{ ok: false; message: string } | null> {
  const { documents } = await getCapabilities();
  if (documents) return null;
  return {
    ok: false,
    message:
      "Invoices, receipts and waybills need database upgrade 0026. " +
      "Run database/UPGRADE_0026_DOCUMENTS.sql, then reload.",
  };
}

// ===================================================================
// Invoices
// ===================================================================

export interface InvoiceSummaryRow {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  status: string;
  issueDate: string;
  dueDate: string;
  total: number;
  amountPaid: number;
  balance: number;
  isOverdue: boolean;
  saleNumber: string | null;
}

const mapInvoice = (row: Record<string, unknown>): InvoiceSummaryRow => ({
  id: row.id as string,
  invoiceNumber: row.invoice_number as string,
  customerId: row.customer_id as string,
  customerName: (row.customer_name as string) ?? "Unknown customer",
  status: (row.status as string) ?? "issued",
  issueDate: row.issue_date as string,
  dueDate: row.due_date as string,
  total: parseAmount(row.total as string),
  amountPaid: parseAmount(row.amount_paid as string),
  balance: parseAmount(row.balance as string),
  isOverdue: Boolean(row.is_overdue),
  saleNumber: (row.sale_number as string) ?? null,
});

export async function listInvoices(
  filters: { status?: string; search?: string; customerId?: string; page?: number } = {},
): Promise<Result<{ invoices: InvoiceSummaryRow[]; total: number; page: number }>> {
  const unavailable = await requireDocuments();
  if (unavailable) return unavailable;

  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Number(filters.page ?? 1));

  let query = supabase
    .from("invoice_detail")
    .select("*", { count: "exact" })
    .order("issue_date", { ascending: false })
    .order("invoice_number", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  // "Open" is the working view: what is still owed, whatever its age.
  if (filters.status === "open") query = query.gt("balance", 0);
  else if (filters.status === "overdue") query = query.eq("is_overdue", true);
  else if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);

  if (filters.customerId) query = query.eq("customer_id", filters.customerId);

  const search = filters.search?.trim();
  if (search) {
    const safe = search.replace(/[%,()]/g, " ");
    query = query.or(`invoice_number.ilike.%${safe}%,customer_name.ilike.%${safe}%`);
  }

  const { data, error, count } = await query;
  if (error) return failed("documents", error, "Invoices could not be loaded.");

  const invoices = (data ?? []).map(mapInvoice);
  return { ok: true, data: { invoices, total: count ?? invoices.length, page } };
}

export interface InvoiceLine {
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  lineTotal: number;
}

export interface InvoiceReceipt {
  id: string;
  paymentNumber: string;
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string;
}

export interface InvoiceDocument extends InvoiceSummaryRow {
  customerCode: string;
  customerPhone: string | null;
  customerAddress: string | null;
  subtotal: number;
  taxTotal: number;
  soldAt: string | null;
  soldBy: string | null;
  lines: InvoiceLine[];
  receipts: InvoiceReceipt[];
}

export async function getInvoice(id: string): Promise<Result<InvoiceDocument | null>> {
  const unavailable = await requireDocuments();
  if (unavailable) return unavailable;

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("invoice_detail")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return failed("documents", error, "This invoice could not be loaded.");
  if (!data) return { ok: true, data: null };

  const row = data as Record<string, unknown>;
  const saleId = row.van_sale_id as string | null;

  // The lines come from the sale, so the document says what was
  // actually handed over rather than a total with no detail.
  const [lines, receipts] = await Promise.all([
    saleId
      ? supabase
          .from("van_sale_items")
          .select("quantity, unit_price, tax_rate, line_total, products(name, sku)")
          .eq("sale_id", saleId)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("payments")
      .select("id, payment_number, amount, method, reference, paid_at")
      .eq("invoice_id", id)
      .order("paid_at", { ascending: true }),
  ]);

  if (lines.error) console.error("[documents] invoice lines", lines.error);
  if (receipts.error) console.error("[documents] invoice receipts", receipts.error);

  return {
    ok: true,
    data: {
      ...mapInvoice(row),
      customerCode: (row.customer_code as string) ?? "",
      customerPhone: (row.customer_phone as string) ?? null,
      customerAddress: (row.customer_address as string) ?? null,
      subtotal: parseAmount(row.subtotal as string),
      taxTotal: parseAmount(row.tax_total as string),
      soldAt: (row.sold_at as string) ?? null,
      soldBy: (row.sold_by as string) ?? null,
      lines: (lines.data ?? []).map((l: Record<string, unknown>) => {
        const product = l.products as { name?: string; sku?: string } | null;
        return {
          productName: product?.name ?? "Item",
          sku: product?.sku ?? "",
          quantity: Number(l.quantity ?? 0),
          unitPrice: parseAmount(l.unit_price as string),
          taxRate: parseAmount(l.tax_rate as string),
          lineTotal: parseAmount(l.line_total as string),
        };
      }),
      receipts: (receipts.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        paymentNumber: r.payment_number as string,
        amount: parseAmount(r.amount as string),
        method: (r.method as string) ?? "cash",
        reference: (r.reference as string) ?? null,
        paidAt: r.paid_at as string,
      })),
    },
  };
}

export interface InvoiceTotals {
  outstanding: number;
  overdue: number;
  issuedThisMonth: number;
  openCount: number;
}

export async function getInvoiceTotals(): Promise<Result<InvoiceTotals>> {
  const unavailable = await requireDocuments();
  if (unavailable) return unavailable;

  const supabase = await createSupabaseServerClient();
  const monthStart = new Date();
  monthStart.setDate(1);

  const { data, error } = await supabase
    .from("invoice_detail")
    .select("balance, total, issue_date, is_overdue, status");

  if (error) return failed("documents", error, "Invoice totals could not be loaded.");

  const rows = data ?? [];
  const open = rows.filter((r) => parseAmount(r.balance as string) > 0);

  return {
    ok: true,
    data: {
      outstanding: open.reduce((sum, r) => sum + parseAmount(r.balance as string), 0),
      overdue: open
        .filter((r) => r.is_overdue)
        .reduce((sum, r) => sum + parseAmount(r.balance as string), 0),
      issuedThisMonth: rows
        .filter((r) => new Date(r.issue_date as string) >= monthStart)
        .reduce((sum, r) => sum + parseAmount(r.total as string), 0),
      openCount: open.length,
    },
  };
}

// ===================================================================
// Receipts
// ===================================================================

export interface ReceiptDocument {
  id: string;
  paymentNumber: string;
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string;
  receivedBy: string | null;
  invoiceNumber: string;
  invoiceTotal: number;
  invoiceBalance: number;
  customerId: string;
  customerCode: string;
  customerName: string;
  customerPhone: string | null;
}

export async function getReceipt(id: string): Promise<Result<ReceiptDocument | null>> {
  const unavailable = await requireDocuments();
  if (unavailable) return unavailable;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("receipt_detail")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return failed("documents", error, "This receipt could not be loaded.");
  if (!data) return { ok: true, data: null };

  const row = data as Record<string, unknown>;
  return {
    ok: true,
    data: {
      id: row.id as string,
      paymentNumber: row.payment_number as string,
      amount: parseAmount(row.amount as string),
      method: (row.method as string) ?? "cash",
      reference: (row.reference as string) ?? null,
      paidAt: row.paid_at as string,
      receivedBy: (row.received_by as string) ?? null,
      invoiceNumber: row.invoice_number as string,
      invoiceTotal: parseAmount(row.invoice_total as string),
      invoiceBalance: parseAmount(row.invoice_balance as string),
      customerId: row.customer_id as string,
      customerCode: (row.customer_code as string) ?? "",
      customerName: (row.customer_name as string) ?? "Unknown customer",
      customerPhone: (row.customer_phone as string) ?? null,
    },
  };
}

// ===================================================================
// Waybills
// ===================================================================

export interface WaybillSummaryRow {
  id: string;
  waybillNumber: string;
  status: string;
  issuedOn: string;
  destination: string;
  driverName: string | null;
  itemCount: number;
  totalQuantity: number;
  referenceType: string | null;
}

export async function listWaybills(
  filters: { status?: string; search?: string; page?: number } = {},
): Promise<Result<{ waybills: WaybillSummaryRow[]; total: number; page: number }>> {
  const unavailable = await requireDocuments();
  if (unavailable) return unavailable;

  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Number(filters.page ?? 1));

  let query = supabase
    .from("waybills")
    .select(
      "id, waybill_number, status, issued_on, destination, reference_type, " +
      "vans(code), customers(name), profiles!waybills_driver_id_fkey(full_name), " +
      "waybill_items(quantity)",
      { count: "exact" },
    )
    .order("issued_on", { ascending: false })
    .order("waybill_number", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);

  const search = filters.search?.trim();
  if (search) query = query.ilike("waybill_number", `%${search.replace(/[%,()]/g, " ")}%`);

  const { data, error, count } = await query;
  if (error) return failed("documents", error, "Waybills could not be loaded.");

  const waybills = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const van = row.vans as { code?: string } | null;
    const customer = row.customers as { name?: string } | null;
    const driver = row.profiles as { full_name?: string } | null;
    const items = (row.waybill_items as { quantity: number }[] | null) ?? [];
    return {
      id: row.id as string,
      waybillNumber: row.waybill_number as string,
      status: (row.status as string) ?? "draft",
      issuedOn: row.issued_on as string,
      // Whichever of the three the waybill names, in the order a
      // dispatcher would read it.
      destination: van?.code ?? customer?.name ?? (row.destination as string) ?? "Unspecified",
      driverName: driver?.full_name ?? null,
      itemCount: items.length,
      totalQuantity: items.reduce((sum, i) => sum + Number(i.quantity ?? 0), 0),
      referenceType: (row.reference_type as string) ?? null,
    };
  });

  return { ok: true, data: { waybills, total: count ?? waybills.length, page } };
}

export interface WaybillLine {
  productName: string;
  sku: string;
  unit: string;
  quantity: number;
  notes: string | null;
}

export interface WaybillDocument extends WaybillSummaryRow {
  vanCode: string | null;
  vanRegistration: string | null;
  customerName: string | null;
  warehouseName: string | null;
  deliveredAt: string | null;
  receivedByName: string | null;
  notes: string | null;
  lines: WaybillLine[];
}

export async function getWaybill(id: string): Promise<Result<WaybillDocument | null>> {
  const unavailable = await requireDocuments();
  if (unavailable) return unavailable;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("waybills")
    .select(
      "id, waybill_number, status, issued_on, destination, reference_type, " +
      "delivered_at, received_by, notes, " +
      "vans(code, registration_no), customers(name), warehouses(name), " +
      "profiles!waybills_driver_id_fkey(full_name), " +
      "waybill_items(quantity, notes, products(name, sku, unit_of_measure))",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return failed("documents", error, "This waybill could not be loaded.");
  if (!data) return { ok: true, data: null };

  const row = data as unknown as Record<string, unknown>;
  const van = row.vans as { code?: string; registration_no?: string } | null;
  const customer = row.customers as { name?: string } | null;
  const warehouse = row.warehouses as { name?: string } | null;
  const driver = row.profiles as { full_name?: string } | null;
  const items = (row.waybill_items as Record<string, unknown>[] | null) ?? [];

  return {
    ok: true,
    data: {
      id: row.id as string,
      waybillNumber: row.waybill_number as string,
      status: (row.status as string) ?? "draft",
      issuedOn: row.issued_on as string,
      destination: van?.code ?? customer?.name ?? (row.destination as string) ?? "Unspecified",
      driverName: driver?.full_name ?? null,
      itemCount: items.length,
      totalQuantity: items.reduce((sum, i) => sum + Number(i.quantity ?? 0), 0),
      referenceType: (row.reference_type as string) ?? null,
      vanCode: van?.code ?? null,
      vanRegistration: van?.registration_no ?? null,
      customerName: customer?.name ?? null,
      warehouseName: warehouse?.name ?? null,
      deliveredAt: (row.delivered_at as string) ?? null,
      receivedByName: (row.received_by as string) ?? null,
      notes: (row.notes as string) ?? null,
      lines: items.map((i) => {
        const product = i.products as
          { name?: string; sku?: string; unit_of_measure?: string } | null;
        return {
          productName: product?.name ?? "Item",
          sku: product?.sku ?? "",
          unit: product?.unit_of_measure ?? "unit",
          quantity: Number(i.quantity ?? 0),
          notes: (i.notes as string) ?? null,
        };
      }),
    },
  };
}

/** Dispatched loads that have not been given a waybill yet. */
export async function listLoadsAwaitingWaybill(): Promise<Result<
  { id: string; loadNumber: string; vanCode: string; driverName: string; loadDate: string }[]
>> {
  const unavailable = await requireDocuments();
  if (unavailable) return unavailable;

  const supabase = await createSupabaseServerClient();

  const [loads, issued] = await Promise.all([
    supabase
      .from("van_loads")
      .select("id, load_number, load_date, vans(code), profiles!van_loads_driver_id_fkey(full_name)")
      .in("status", ["dispatched", "returned"])
      .order("load_date", { ascending: false })
      .limit(50),
    supabase.from("waybills").select("reference_id").eq("reference_type", "van_load"),
  ]);

  if (loads.error) return failed("documents", loads.error, "Van loads could not be loaded.");

  const already = new Set((issued.data ?? []).map((w) => w.reference_id as string));

  return {
    ok: true,
    data: ((loads.data ?? []) as unknown as Record<string, unknown>[])
      .filter((l) => !already.has(l.id as string))
      .map((l) => {
        const van = l.vans as { code?: string } | null;
        const driver = l.profiles as { full_name?: string } | null;
        return {
          id: l.id as string,
          loadNumber: l.load_number as string,
          vanCode: van?.code ?? "Van",
          driverName: driver?.full_name ?? "Unassigned",
          loadDate: l.load_date as string,
        };
      }),
  };
}
