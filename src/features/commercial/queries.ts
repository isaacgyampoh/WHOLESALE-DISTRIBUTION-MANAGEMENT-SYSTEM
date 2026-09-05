import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";
import { type Result, failed } from "@/lib/query/result";
import { getCapabilities } from "@/lib/db/capabilities";

/**
 * Customers, sales, credit and collections.
 *
 * Money is read from the ledger views rather than recomputed here.
 * `customer_credit_position` and `invoice_ageing` already agree with the
 * accounting rules the database enforces, and a second implementation in
 * TypeScript would eventually disagree with them.
 */

export const PAGE_SIZE = 25;

export interface CustomerRow {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
  creditLimit: number;
  paymentTermsDays: number;
  priceTier: string;
  isActive: boolean;
  balance: number;
  creditAvailable: number;
  overLimit: boolean;
  daysPastDue: number | null;
}

export interface CustomerFilters {
  search?: string;
  status?: string;
  credit?: string;
  page?: number;
}

export async function listCustomers(
  filters: CustomerFilters = {},
): Promise<Result<{ customers: CustomerRow[]; total: number; page: number }>> {
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Number(filters.page ?? 1));

  let query = supabase
    .from("customers")
    .select(
      "id, code, name, contact_name, phone, city, region, credit_limit, " +
      "payment_terms_days, price_tier, is_active",
      { count: "exact" },
    )
    .order("name");

  if (filters.status === "active") query = query.eq("is_active", true);
  if (filters.status === "inactive") query = query.eq("is_active", false);

  const search = filters.search?.trim();
  if (search) {
    const safe = search.replace(/[%,()]/g, " ");
    query = query.or(`name.ilike.%${safe}%,code.ilike.%${safe}%,phone.ilike.%${safe}%`);
  }

  // Credit state comes from a view, so it is applied after the rows
  // arrive. Everything the database can narrow has been narrowed first.
  const byCredit = filters.credit && filters.credit !== "all";
  if (!byCredit) query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [{ data, error, count }, positions] = await Promise.all([
    query,
    supabase
      .from("customer_credit_position")
      .select("customer_id, ledger_balance, credit_available, over_limit, days_past_due"),
  ]);

  if (error) return failed("customers", error, "Customers could not be loaded.");

  const positionBy = new Map<string, Record<string, unknown>>();
  for (const p of positions.data ?? []) positionBy.set(p.customer_id as string, p);

  let customers: CustomerRow[] = ((data ?? []) as unknown as Record<string, unknown>[]).map((c) => {
    const p = positionBy.get(c.id as string);
    const creditLimit = parseAmount(c.credit_limit as string);
    return {
      id: c.id as string,
      code: c.code as string,
      name: c.name as string,
      contactName: (c.contact_name as string | null) ?? null,
      phone: (c.phone as string | null) ?? null,
      city: (c.city as string | null) ?? null,
      region: (c.region as string | null) ?? null,
      creditLimit,
      paymentTermsDays: Number(c.payment_terms_days ?? 0),
      priceTier: (c.price_tier as string) ?? "standard",
      isActive: c.is_active as boolean,
      balance: parseAmount(p?.ledger_balance as string),
      creditAvailable: p ? parseAmount(p.credit_available as string) : creditLimit,
      overLimit: Boolean(p?.over_limit),
      daysPastDue: p?.days_past_due === null || p?.days_past_due === undefined
        ? null : Number(p.days_past_due),
    };
  });

  let total = count ?? customers.length;
  if (byCredit) {
    customers = customers.filter((c) =>
      filters.credit === "owing" ? c.balance > 0 :
      filters.credit === "over_limit" ? c.overLimit :
      filters.credit === "overdue" ? (c.daysPastDue ?? 0) > 0 : true);
    total = customers.length;
    customers = customers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }

  return { ok: true, data: { customers, total, page } };
}

export async function getCustomer(id: string): Promise<Result<CustomerRow | null>> {
  const result = await listCustomers({});
  if (!result.ok) return result;
  return { ok: true, data: result.data.customers.find((c) => c.id === id) ?? null };
}

export interface SaleRow {
  id: string;
  saleNumber: string;
  customerName: string;
  customerId: string;
  driverName: string;
  vanCode: string;
  saleType: string;
  status: string;
  soldAt: string;
  total: number;
  amountPaid: number;
  balance: number;
  lineCount: number;
}

export interface SaleFilters {
  search?: string;
  saleType?: string;
  status?: string;
  customerId?: string;
  driverId?: string;
  periodDays?: number;
  page?: number;
}

export async function listSales(
  filters: SaleFilters = {},
): Promise<Result<{ sales: SaleRow[]; total: number; page: number }>> {
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Number(filters.page ?? 1));

  let query = supabase
    .from("van_sales")
    .select(
      "id, sale_number, sale_type, status, sold_at, total, amount_paid, balance, " +
      // Named explicitly: since the crew model, van_sales has two
      // foreign keys to profiles - who sold it and who drove - and
      // PostgREST refuses a bare embed it cannot disambiguate.
      "customer_id, customers(name), vans(code), van_sale_items(id), " +
      "salesperson:profiles!van_sales_salesperson_id_fkey(full_name), " +
      "driver:profiles!van_sales_driver_id_fkey(full_name)",
      { count: "exact" },
    )
    .order("sold_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (filters.saleType && filters.saleType !== "all") query = query.eq("sale_type", filters.saleType);
  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.customerId) query = query.eq("customer_id", filters.customerId);
  if (filters.driverId) query = query.eq("driver_id", filters.driverId);
  if (filters.periodDays) {
    query = query.gte("sold_at", new Date(Date.now() - filters.periodDays * 86_400_000).toISOString());
  }

  const search = filters.search?.trim();
  if (search) query = query.ilike("sale_number", `%${search.replace(/[%,()]/g, " ")}%`);

  const { data, error, count } = await query;
  if (error) return failed("sales", error, "Sales could not be loaded.");

  const sales = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    saleNumber: row.sale_number as string,
    customerName: (row.customers as { name?: string } | null)?.name ?? "Unknown customer",
    customerId: row.customer_id as string,
    // Whoever made the sale. Since the crew model the driver is a
    // different person, embedded separately above.
    driverName: (row.salesperson as { full_name?: string } | null)?.full_name
      ?? (row.driver as { full_name?: string } | null)?.full_name ?? "-",
    vanCode: (row.vans as { code?: string } | null)?.code ?? "-",
    saleType: row.sale_type as string,
    status: row.status as string,
    soldAt: row.sold_at as string,
    total: parseAmount(row.total as string),
    amountPaid: parseAmount(row.amount_paid as string),
    balance: parseAmount(row.balance as string),
    lineCount: ((row.van_sale_items as unknown[] | null) ?? []).length,
  }));

  return { ok: true, data: { sales, total: count ?? sales.length, page } };
}

export interface SalesSummary {
  saleCount: number;
  grossValue: number;
  cashValue: number;
  creditValue: number;
  outstanding: number;
}

export async function getSalesSummary(periodDays = 30): Promise<Result<SalesSummary>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("van_sales")
    .select("sale_type, total, amount_paid, balance, status")
    .gte("sold_at", new Date(Date.now() - periodDays * 86_400_000).toISOString());

  if (error) return failed("sales", error, "The sales summary could not be loaded.");

  const rows = (data ?? []).filter((r) => r.status !== "void");
  return {
    ok: true,
    data: {
      saleCount: rows.length,
      grossValue: rows.reduce((s, r) => s + parseAmount(r.total as string), 0),
      cashValue: rows.filter((r) => r.sale_type === "cash")
        .reduce((s, r) => s + parseAmount(r.total as string), 0),
      creditValue: rows.filter((r) => r.sale_type === "credit")
        .reduce((s, r) => s + parseAmount(r.total as string), 0),
      outstanding: rows.reduce((s, r) => s + parseAmount(r.balance as string), 0),
    },
  };
}

export interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerId: string;
  dueDate: string;
  total: number;
  balance: number;
  daysOverdue: number;
  bucket: string;
}

export async function listOverdueInvoices(
  filters: { bucket?: string; search?: string; page?: number } = {},
): Promise<Result<{ invoices: InvoiceRow[]; total: number; page: number }>> {
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Number(filters.page ?? 1));

  let query = supabase
    .from("invoice_ageing")
    .select("*", { count: "exact" })
    .order("days_overdue", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (filters.bucket && filters.bucket !== "all") query = query.eq("bucket", filters.bucket);
  const search = filters.search?.trim();
  if (search) query = query.ilike("invoice_number", `%${search.replace(/[%,()]/g, " ")}%`);

  const { data, error, count } = await query;
  if (error) return failed("credit", error, "Outstanding invoices could not be loaded.");

  const invoices = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    invoiceNumber: row.invoice_number as string,
    customerName: (row.customer_name as string) ?? "Unknown customer",
    customerId: row.customer_id as string,
    dueDate: row.due_date as string,
    total: parseAmount(row.total as string),
    balance: parseAmount(row.balance as string),
    daysOverdue: Number(row.days_overdue ?? 0),
    bucket: (row.bucket as string) ?? "current",
  }));

  return { ok: true, data: { invoices, total: count ?? invoices.length, page } };
}

export interface PaymentRow {
  id: string;
  paymentNumber: string;
  customerName: string;
  invoiceNumber: string;
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string;
  receivedBy: string | null;
}

export async function listPayments(
  filters: { method?: string; search?: string; periodDays?: number; page?: number } = {},
): Promise<Result<{ payments: PaymentRow[]; total: number; page: number }>> {
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Number(filters.page ?? 1));

  let query = supabase
    .from("payments")
    .select(
      "id, payment_number, amount, method, reference, paid_at, " +
      "invoices(invoice_number, customers(name)), profiles(full_name)",
      { count: "exact" },
    )
    .order("paid_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (filters.method && filters.method !== "all") query = query.eq("method", filters.method);
  if (filters.periodDays) {
    query = query.gte("paid_at", new Date(Date.now() - filters.periodDays * 86_400_000).toISOString());
  }
  const search = filters.search?.trim();
  if (search) query = query.ilike("payment_number", `%${search.replace(/[%,()]/g, " ")}%`);

  const { data, error, count } = await query;
  if (error) return failed("payments", error, "Payments could not be loaded.");

  const payments = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const invoice = row.invoices as { invoice_number?: string; customers?: { name?: string } } | null;
    return {
      id: row.id as string,
      paymentNumber: row.payment_number as string,
      customerName: invoice?.customers?.name ?? "Unknown customer",
      invoiceNumber: invoice?.invoice_number ?? "-",
      amount: parseAmount(row.amount as string),
      method: row.method as string,
      reference: (row.reference as string | null) ?? null,
      paidAt: row.paid_at as string,
      receivedBy: (row.profiles as { full_name?: string } | null)?.full_name ?? null,
    };
  });

  return { ok: true, data: { payments, total: count ?? payments.length, page } };
}

export interface CreditSummary {
  outstanding: number;
  overdue: number;
  customersOwing: number;
  overLimit: number;
}

export async function getCreditSummary(): Promise<Result<CreditSummary>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("customer_credit_position")
    .select("ledger_balance, over_limit, days_past_due");

  if (error) return failed("credit", error, "The credit summary could not be loaded.");

  const rows = data ?? [];
  return {
    ok: true,
    data: {
      outstanding: rows.reduce((s, r) => s + Math.max(0, parseAmount(r.ledger_balance as string)), 0),
      overdue: rows.filter((r) => Number(r.days_past_due ?? 0) > 0)
        .reduce((s, r) => s + Math.max(0, parseAmount(r.ledger_balance as string)), 0),
      customersOwing: rows.filter((r) => parseAmount(r.ledger_balance as string) > 0).length,
      overLimit: rows.filter((r) => r.over_limit).length,
    },
  };
}

export interface CollectionRow {
  id: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  amount: number;
  method: string;
  notes: string | null;
  occurredAt: string;
  receivedBy: string | null;
}

/**
 * Collections.
 *
 * A collection is a payment entry on the customer ledger, which is what
 * record_credit_payment() writes. Amounts are stored negative there,
 * because that is what a payment does to a balance; they are shown
 * positive because that is what a person handed over.
 */
export async function listCollections(
  filters: { method?: string; search?: string; periodDays?: number; page?: number } = {},
): Promise<Result<{ collections: CollectionRow[]; total: number; page: number }>> {
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, Number(filters.page ?? 1));

  let query = supabase
    .from("credit_transactions")
    .select(
      "id, customer_id, amount, reference_type, notes, occurred_at, " +
      "customers(name, code), profiles(full_name)",
      { count: "exact" },
    )
    .eq("type", "payment")
    .order("occurred_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  // The method is kept in reference_type by record_credit_payment().
  if (filters.method && filters.method !== "all") query = query.eq("reference_type", filters.method);
  if (filters.periodDays) {
    query = query.gte("occurred_at", new Date(Date.now() - filters.periodDays * 86_400_000).toISOString());
  }

  const { data, error, count } = await query;
  if (error) return failed("collections", error, "Collections could not be loaded.");

  let collections = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const customer = row.customers as { name?: string; code?: string } | null;
    return {
      id: row.id as string,
      customerId: row.customer_id as string,
      customerName: customer?.name ?? "Unknown customer",
      customerCode: customer?.code ?? "",
      amount: Math.abs(parseAmount(row.amount as string)),
      method: (row.reference_type as string | null) ?? "cash",
      notes: (row.notes as string | null) ?? null,
      occurredAt: row.occurred_at as string,
      receivedBy: (row.profiles as { full_name?: string } | null)?.full_name ?? null,
    };
  });

  // Customer name is on the joined row, so this last narrowing happens
  // here rather than in the query.
  const search = filters.search?.trim().toLowerCase();
  if (search) {
    collections = collections.filter((c) =>
      c.customerName.toLowerCase().includes(search) ||
      c.customerCode.toLowerCase().includes(search));
  }

  return { ok: true, data: { collections, total: search ? collections.length : (count ?? collections.length), page } };
}

export interface CollectionsSummary {
  received: number;
  count: number;
  cash: number;
  mobileMoney: number;
}

export async function getCollectionsSummary(periodDays = 30): Promise<Result<CollectionsSummary>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("credit_transactions")
    .select("amount, reference_type")
    .eq("type", "payment")
    .gte("occurred_at", new Date(Date.now() - periodDays * 86_400_000).toISOString());

  if (error) return failed("collections", error, "The collections summary could not be loaded.");

  const rows = (data ?? []).map((r) => ({
    amount: Math.abs(parseAmount(r.amount as string)),
    method: (r.reference_type as string | null) ?? "cash",
  }));

  return {
    ok: true,
    data: {
      received: rows.reduce((s, r) => s + r.amount, 0),
      count: rows.length,
      cash: rows.filter((r) => r.method === "cash").reduce((s, r) => s + r.amount, 0),
      mobileMoney: rows.filter((r) => r.method === "mobile_money").reduce((s, r) => s + r.amount, 0),
    },
  };
}

/**
 * What the shop can sell over the counter, from one warehouse.
 *
 * The van till reads a cached snapshot of what a van is carrying,
 * because a round happens where there is no signal. A counter sale
 * happens at the counter, so this reads the shelf directly and does not
 * pretend otherwise.
 *
 * Prices come from products_priced, which is the masked view: cost is
 * null for anyone not entitled to it, and nobody serving a customer
 * needs it.
 */
export interface CounterProduct {
  id: string;
  sku: string;
  name: string;
  unit: string;
  unitsPerCase: number;
  listPrice: number;
  /** Null where nobody has set one. Pieces cannot be sold without it. */
  piecePrice: number | null;
  taxRate: number;
  onHand: number;
  onHandPieces: number;
}

export async function listCounterStock(warehouseId: string): Promise<Result<CounterProduct[]>> {
  const supabase = await createSupabaseServerClient();
  const capabilities = await getCapabilities();

  const [{ data: products, error }, { data: levels }] = await Promise.all([
    supabase
      .from("products_priced")
      .select(capabilities.loosePieces
        ? "id, sku, name, unit_of_measure, units_per_case, list_price, piece_price, tax_rate"
        : "id, sku, name, unit_of_measure, units_per_case, list_price, tax_rate")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("inventory")
      .select(capabilities.loosePieces
        ? "product_id, qty_available, qty_pieces"
        : "product_id, qty_available")
      .eq("warehouse_id", warehouseId),
  ]);

  if (error) return failed("commercial", error, "The shop stock could not be loaded.");

  const rows = (levels ?? []) as unknown as {
    product_id: string; qty_available: number | null; qty_pieces?: number | null;
  }[];
  const onHand = new Map(rows.map((r) => [r.product_id, Number(r.qty_available ?? 0)]));
  const loose = new Map(rows.map((r) => [r.product_id, Number(r.qty_pieces ?? 0)]));

  return {
    ok: true,
    // Only what is actually on the shelf. A counter list of everything
    // the business has ever sold is a list nobody can serve from.
    data: ((products ?? []) as unknown as Record<string, unknown>[])
      .map((p) => ({
        id: p.id as string,
        sku: (p.sku as string) ?? "",
        name: p.name as string,
        unit: (p.unit_of_measure as string) ?? "unit",
        unitsPerCase: Number(p.units_per_case ?? 1),
        listPrice: parseAmount(p.list_price as string),
        piecePrice: p.piece_price === null || p.piece_price === undefined
          ? null : parseAmount(p.piece_price as string),
        taxRate: parseAmount(p.tax_rate as string),
        onHand: onHand.get(p.id as string) ?? 0,
        onHandPieces: loose.get(p.id as string) ?? 0,
      }))
      .filter((p) => p.onHand > 0 || p.onHandPieces > 0),
  };
}
