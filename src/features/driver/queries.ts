import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/utils/format";
import { type Result, failed } from "@/lib/query/result";
import { getCapabilities } from "@/lib/db/capabilities";
import { requireUser } from "@/lib/auth/session";

/**
 * The driver's own round.
 *
 * Everything here is scoped to the signed-in driver by row level
 * security - my_van_id() and the driver policies decide what comes
 * back, so passing a different driver's id would return nothing rather
 * than somebody else's day.
 */

export interface DriverRound {
  van: { id: string; code: string; registrationNo: string } | null;
  load: {
    id: string;
    loadNumber: string;
    loadDate: string;
    status: string;
    openingFloat: number;
    loadedValue: number;
    lineCount: number;
  } | null;
  stockUnits: number;
  cashSales: number;
  creditSales: number;
  saleCount: number;
  collections: number;
  reconciliation: {
    id: string;
    reconNumber: string;
    status: string;
    expectedCash: number;
  } | null;
  hasSubmittedReturn: boolean;
}

export async function getDriverRound(driverId: string): Promise<Result<DriverRound>> {
  const supabase = await createSupabaseServerClient();

  const { data: assignment, error: assignmentError } = await supabase
    .from("van_assignments")
    .select("van_id, vans(id, code, registration_no)")
    .is("unassigned_at", null)
    .maybeSingle();

  if (assignmentError) {
    return failed("driver", assignmentError, "Your round could not be loaded.");
  }

  const vanRow = assignment?.vans as
    { id?: string; code?: string; registration_no?: string } | null;
  const van = vanRow?.id
    ? { id: vanRow.id, code: vanRow.code ?? "", registrationNo: vanRow.registration_no ?? "" }
    : null;

  if (!van) {
    return {
      ok: true,
      data: {
        van: null, load: null, stockUnits: 0,
        cashSales: 0, creditSales: 0, saleCount: 0, collections: 0,
        reconciliation: null, hasSubmittedReturn: false,
      },
    };
  }

  const [loadRes, stockRes, salesRes, reconRes, returnRes, collectionsRes] = await Promise.all([
    supabase
      .from("van_loads")
      // unit_price is the selling price the load was priced at, not a
      // cost. A driver may see it; it is what they charge.
      .select("id, load_number, load_date, status, opening_float, van_load_items(qty_loaded, unit_price)")
      .eq("van_id", van.id)
      .in("status", ["loaded", "dispatched", "returned"])
      .order("load_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("van_stock_summary")
      // Quantities only. stock_value is quantity times cost, and a
      // driver has no business with cost - the view returns null for
      // them anyway, so asking for it would only invite a zero that
      // looks like a real figure.
      .select("qty_on_hand")
      .eq("van_id", van.id),
    supabase
      .from("van_sales")
      .select("sale_type, total, status")
      .eq("van_id", van.id)
      .neq("status", "void")
      .gte("sold_at", new Date(Date.now() - 86_400_000).toISOString()),
    supabase
      .from("van_reconciliations")
      .select("id, recon_number, status, expected_cash")
      .eq("van_id", van.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("van_returns")
      .select("id, status")
      .eq("van_id", van.id)
      .in("status", ["submitted", "approved"])
      .order("returned_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("credit_transactions")
      .select("amount")
      .eq("type", "payment")
      .eq("created_by", driverId)
      .gte("occurred_at", new Date(Date.now() - 86_400_000).toISOString()),
  ]);

  const loadRow = loadRes.data as Record<string, unknown> | null;
  const items = (loadRow?.van_load_items as Array<{ qty_loaded: number; unit_price: string }> | null) ?? [];
  const sales = salesRes.data ?? [];

  return {
    ok: true,
    data: {
      van,
      load: loadRow
        ? {
            id: loadRow.id as string,
            loadNumber: loadRow.load_number as string,
            loadDate: loadRow.load_date as string,
            status: loadRow.status as string,
            openingFloat: parseAmount(loadRow.opening_float as string),
            loadedValue: items.reduce(
              (s, i) => s + Number(i.qty_loaded ?? 0) * parseAmount(i.unit_price), 0),
            lineCount: items.length,
          }
        : null,
      stockUnits: (stockRes.data ?? []).reduce((s, r) => s + Number(r.qty_on_hand ?? 0), 0),
      cashSales: sales.filter((s) => s.sale_type === "cash")
        .reduce((s, r) => s + parseAmount(r.total as string), 0),
      creditSales: sales.filter((s) => s.sale_type === "credit")
        .reduce((s, r) => s + parseAmount(r.total as string), 0),
      saleCount: sales.length,
      collections: (collectionsRes.data ?? [])
        .reduce((s, r) => s + Math.abs(parseAmount(r.amount as string)), 0),
      reconciliation: reconRes.data
        ? {
            id: reconRes.data.id as string,
            reconNumber: reconRes.data.recon_number as string,
            status: reconRes.data.status as string,
            expectedCash: parseAmount(reconRes.data.expected_cash as string),
          }
        : null,
      hasSubmittedReturn: Boolean(returnRes.data),
    },
  };
}

/**
 * What the till needs, from the server.
 *
 * The same shape the device caches for offline use, so the sell screen
 * can be handed one or the other without knowing which. Rendering it
 * server-side matters for two reasons: the first paint has the round in
 * it rather than waiting on a round trip, and the till keeps working on
 * a database where the offline sync functions have not been installed
 * yet.
 *
 * No cost is fetched. `van_stock_summary` would return null for a
 * driver in any case; not asking makes that explicit.
 */
export async function getSellingRound(): Promise<Result<OfflineSnapshotShape | null>> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  // Whose assignment, said explicitly.
  //
  // This used to select every assignment row the caller could see and
  // take the single one, leaning entirely on row level security to make
  // that "theirs". It holds for a salesperson, who can see only their
  // own row - but a manager opening this screen sees the whole
  // organization's, and maybeSingle turns more than one row into an
  // error, so the round came back empty with nothing to explain it.
  //
  // The van a person sells from is a fact about who they are. It is
  // resolved from the session here and checked again in the database
  // when the sale completes.
  const { data: assignment } = await supabase
    .from("van_assignments")
    .select("van_id, vans(id, code, registration_no)")
    .eq("member_id", user.id)
    .is("unassigned_at", null)
    .maybeSingle();

  const vanRow = assignment?.vans as
    { id?: string; code?: string; registration_no?: string } | null;
  if (!vanRow?.id) return { ok: true, data: null };

  const { data: load } = await supabase
    .from("van_loads")
    .select("id, load_number, status, opening_float")
    .eq("van_id", vanRow.id)
    .in("status", ["loaded", "dispatched"])
    .order("load_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const capabilities = await getCapabilities();

  const [stockRes, priceRes, customerRes] = await Promise.all([
    supabase
      .from("van_stock_summary")
      .select(capabilities.loosePieces
        ? "product_id, sku, product_name, qty_on_hand, qty_pieces, units_per_case, unit_of_measure"
        : "product_id, sku, product_name, qty_on_hand")
      .eq("van_id", vanRow.id)
      .order("product_name"),
    load
      ? supabase
          .from("van_load_items")
          .select(capabilities.loosePieces
            ? "product_id, unit_price, products(tax_rate, image_path, piece_price, units_per_case)"
            : "product_id, unit_price, products(tax_rate, image_path)")
          .eq("load_id", load.id)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase
      .from("customers")
      .select("id, code, name, phone, credit_limit")
      .eq("is_active", true)
      .order("name"),
  ]);

  // The credit position is a view with no foreign key back to customers,
  // so PostgREST cannot embed it. Fetched alongside and joined here -
  // one extra request rather than one per customer.
  const { data: positions } = await supabase
    .from("customer_credit_position")
    .select("customer_id, ledger_balance, credit_available");
  const positionBy = new Map(
    (positions ?? []).map((p) => [p.customer_id as string, p]),
  );

  return {
    ok: true,
    data: {
      cached_at: new Date().toISOString(),
      van: {
        id: vanRow.id,
        code: vanRow.code ?? "",
        registration_no: vanRow.registration_no ?? "",
      },
      load: load
        ? {
            id: load.id as string,
            load_number: load.load_number as string,
            status: load.status as string,
            opening_float: parseAmount(load.opening_float as string),
          }
        : null,
      stock: ((stockRes.data ?? []) as unknown as Record<string, unknown>[]).map((s) => ({
        product_id: s.product_id as string,
        sku: (s.sku as string) ?? "",
        name: (s.product_name as string) ?? "",
        qty_on_hand: Number(s.qty_on_hand ?? 0),
        qty_pieces: Number(s.qty_pieces ?? 0),
        pieces_per_unit: Number(s.units_per_case ?? 1),
        unit: (s.unit_of_measure as string) ?? "unit",
      })),
      prices: ((priceRes.data ?? []) as unknown as Record<string, unknown>[]).map((p) => {
        const product = p.products as {
          tax_rate?: string; image_path?: string; piece_price?: string; units_per_case?: number;
        } | null;
        const unitPrice = parseAmount(p.unit_price as string);
        const pack = Number(product?.units_per_case ?? 1);
        // Derived only where nobody has set a real one, and only where
        // there is a pack size to divide by. It is the wrong price - a
        // single always costs more per piece than the carton it came
        // from - but a visible wrong price beats a piece sold for
        // nothing, and the product page says where to fix it.
        const piecePrice = product?.piece_price !== undefined && product.piece_price !== null
          ? parseAmount(product.piece_price)
          : pack > 1 ? Math.round((unitPrice / pack) * 100) / 100 : 0;

        return {
          product_id: p.product_id as string,
          unit_price: unitPrice,
          tax_rate: parseAmount(product?.tax_rate),
          piece_price: piecePrice,
          image_path: product?.image_path ?? null,
        };
      }),
      customers: ((customerRes.data ?? []) as unknown as Record<string, unknown>[]).map((c) => {
        const position = positionBy.get(c.id as string);
        return {
          id: c.id as string,
          code: (c.code as string) ?? "",
          name: (c.name as string) ?? "",
          phone: (c.phone as string | null) ?? null,
          balance: parseAmount(position?.ledger_balance as string | undefined),
          // A customer with no ledger entries has no row in the view;
          // their whole limit is available.
          credit_available: position?.credit_available === undefined
            ? parseAmount(c.credit_limit as string)
            : parseAmount(position.credit_available as string),
        };
      }),
    },
  };
}

/** Mirrors OfflineSnapshot without importing a browser module here. */
export interface OfflineSnapshotShape {
  cached_at: string;
  van: { id: string; code: string; registration_no: string } | null;
  load: { id: string; load_number: string; status: string; opening_float: number } | null;
  stock: {
    product_id: string; sku: string; name: string; qty_on_hand: number;
    /** Loose pieces on board, never folded into qty_on_hand. */
    qty_pieces: number;
    /** 1 means never split, and the till offers no second figure. */
    pieces_per_unit: number;
    /** For wording the two halves: "3 Cartons + 2 Pieces". */
    unit: string;
  }[];
  prices: {
    product_id: string; unit_price: number; tax_rate: number;
    /**
     * What one loose piece sells for. Falls back to unit_price over the
     * pack size where nobody has set one - the wrong number, but a
     * visible one rather than a piece sold for nothing.
     */
    piece_price: number;
    /** Public bucket path, so the till can show it with no signal. */
    image_path: string | null;
  }[];
  customers: {
    id: string; code: string; name: string; phone: string | null;
    balance: number; credit_available: number;
  }[];
}

// ===================================================================
// The van I am crewed on
// ===================================================================

export interface MyVan {
  vanId: string;
  vanCode: string;
  registrationNo: string;
  myRole: "driver" | "salesperson";
  driverName: string | null;
  salespeople: { memberId: string; memberName: string; memberPhone: string | null }[];
  stockLines: number;
  stockUnits: number;
  openLoad: string | null;
  loadStatus: string | null;
  loadDate: string | null;
}

/**
 * Whichever van this person is on, and who else is on it.
 *
 * Works for a driver and for a salesperson: the crew table does not care
 * which job somebody does when answering "where are you today".
 */
export async function getMyVanCrew(userId: string): Promise<Result<MyVan | null>> {
  const { vanCrew } = await getCapabilities();
  if (!vanCrew) {
    return {
      ok: false,
      message:
        "Van crews need database upgrade 0032. " +
        "Run database/UPGRADE_0032_VAN_CREW.sql, then reload.",
    };
  }

  const supabase = await createSupabaseServerClient();

  const { data: mine, error } = await supabase
    .from("van_assignments")
    .select("van_id, crew_role, vans(code, registration_no)")
    .eq("member_id", userId)
    .is("unassigned_at", null)
    .maybeSingle();

  if (error) return failed("driver", error, "Your van could not be loaded.");
  if (!mine) return { ok: true, data: null };

  const vanId = mine.van_id as string;
  const van = mine.vans as { code?: string; registration_no?: string } | null;

  const [crew, stock, load] = await Promise.all([
    supabase
      .from("van_assignments")
      .select("member_id, crew_role, profiles!van_assignments_driver_id_fkey(full_name, phone)")
      .eq("van_id", vanId)
      .is("unassigned_at", null),
    supabase.from("van_stock_summary").select("qty_on_hand").eq("van_id", vanId),
    supabase
      .from("van_loads")
      .select("load_number, status, load_date")
      .eq("van_id", vanId)
      .in("status", ["loaded", "dispatched"])
      .maybeSingle(),
  ]);

  const members = ((crew.data ?? []) as unknown as Record<string, unknown>[]).map((c) => {
    const p = c.profiles as { full_name?: string; phone?: string } | null;
    return {
      memberId: c.member_id as string,
      memberName: p?.full_name ?? "Unnamed",
      memberPhone: p?.phone ?? null,
      crewRole: c.crew_role as string,
    };
  });

  const lines = stock.data ?? [];

  return {
    ok: true,
    data: {
      vanId,
      vanCode: van?.code ?? "Van",
      registrationNo: van?.registration_no ?? "",
      myRole: (mine.crew_role as "driver" | "salesperson") ?? "salesperson",
      driverName: members.find((m) => m.crewRole === "driver")?.memberName ?? null,
      salespeople: members
        .filter((m) => m.crewRole === "salesperson")
        .map(({ memberId, memberName, memberPhone }) => ({ memberId, memberName, memberPhone })),
      stockLines: lines.length,
      stockUnits: lines.reduce((s, l) => s + Number(l.qty_on_hand ?? 0), 0),
      openLoad: (load.data?.load_number as string) ?? null,
      loadStatus: (load.data?.status as string) ?? null,
      loadDate: (load.data?.load_date as string) ?? null,
    },
  };
}

export interface VanSaleToday {
  productId: string;
  productName: string;
  sku: string;
  soldToday: number;
  /** What is left on the van now. */
  remaining: number;
}

export interface VanDayActivity {
  lines: VanSaleToday[];
  saleCount: number;
  /** Who sold from this van today. The driver is not among them. */
  soldBy: string[];
}

/**
 * What left this van today, and who took it off.
 *
 * The driver's question, and the one the van page could not answer: the
 * load went out at fifty and there are forty-five on the shelf, and
 * nothing on screen accounted for the five. It is read-only on purpose -
 * the driver is responsible for the vehicle, not the till.
 */
export async function getVanDayActivity(vanId: string): Promise<Result<VanDayActivity>> {
  const supabase = await createSupabaseServerClient();

  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("van_sales")
    .select(
      // Named explicitly: van_sales has two foreign keys to profiles
      // since the crew model, and a bare embed cannot be resolved.
      "id, sold_at, salesperson:profiles!van_sales_salesperson_id_fkey(full_name), " +
      "van_sale_items(product_id, quantity, products(name, sku))",
    )
    .eq("van_id", vanId)
    .eq("status", "completed")
    .gte("sold_at", since.toISOString());

  if (error) return failed("driver", error, "Today's sales could not be loaded.");

  const byProduct = new Map<string, VanSaleToday>();
  const soldBy = new Set<string>();

  for (const sale of (data ?? []) as unknown as Record<string, unknown>[]) {
    const seller = (sale.salesperson as { full_name?: string } | null)?.full_name;
    if (seller) soldBy.add(seller);

    for (const item of (sale.van_sale_items ?? []) as Record<string, unknown>[]) {
      const id = item.product_id as string;
      const product = item.products as { name?: string; sku?: string } | null;
      const line = byProduct.get(id) ?? {
        productId: id,
        productName: product?.name ?? "Unknown product",
        sku: product?.sku ?? "",
        soldToday: 0,
        remaining: 0,
      };
      line.soldToday += Number(item.quantity ?? 0);
      byProduct.set(id, line);
    }
  }

  // What is still on board, so the two figures sit side by side and the
  // arithmetic is visible rather than implied.
  if (byProduct.size > 0) {
    const { data: stock } = await supabase
      .from("van_stock_summary")
      .select("product_id, qty_on_hand")
      .eq("van_id", vanId)
      .in("product_id", [...byProduct.keys()]);

    for (const row of stock ?? []) {
      const line = byProduct.get(row.product_id as string);
      if (line) line.remaining = Number(row.qty_on_hand ?? 0);
    }
  }

  return {
    ok: true,
    data: {
      lines: [...byProduct.values()].sort((a, b) => b.soldToday - a.soldToday),
      saleCount: (data ?? []).length,
      soldBy: [...soldBy],
    },
  };
}

export type RoundBlocker =
  | { kind: "ready" }
  | { kind: "no_van" }
  | { kind: "van_inactive"; vanCode: string }
  | { kind: "no_load"; vanCode: string }
  | { kind: "not_dispatched"; vanCode: string; loadNumber: string }
  | { kind: "empty_van"; vanCode: string; loadNumber: string };

/**
 * Why there is nothing to sell.
 *
 * The screen used to say "no load has been dispatched to your van" for
 * every one of these, which is true of only one of them and actionable
 * in none. A salesperson standing in a yard needs to know which link of
 * the chain is open and who closes it - the warehouse, the driver, or
 * the office - because they cannot fix any of it themselves and the one
 * thing they must not do is wait quietly.
 *
 * Warehouse -> load -> driver confirms -> dispatched -> van stock.
 */
export async function diagnoseRound(): Promise<RoundBlocker> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data: assignment } = await supabase
    .from("van_assignments")
    .select("van_id, vans(code, is_active)")
    .eq("member_id", user.id)
    .is("unassigned_at", null)
    .maybeSingle();

  const van = assignment?.vans as { code?: string; is_active?: boolean } | null;
  if (!assignment?.van_id || !van) return { kind: "no_van" };

  const vanCode = van.code ?? "your van";
  // An inactive van is a vehicle the office has taken off the road. The
  // crew is still assigned to it, which is how somebody ends up on a van
  // that cannot trade and is told only that nothing is loaded.
  if (van.is_active === false) return { kind: "van_inactive", vanCode };

  const { data: load } = await supabase
    .from("van_loads")
    .select("id, load_number, status")
    .eq("van_id", assignment.van_id)
    .in("status", ["draft", "loaded", "dispatched"])
    .order("load_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!load) return { kind: "no_load", vanCode };

  const loadNumber = (load.load_number as string) ?? "the load";

  // A load that has not been dispatched is waiting on the office and
  // nobody else. It used to be able to wait on the driver's signature
  // too, until 0045 removed that gate - and this said so for a while
  // afterwards, sending salespeople to chase a driver who could do
  // nothing about it.
  if (load.status !== "dispatched") {
    return { kind: "not_dispatched", vanCode, loadNumber };
  }

  const { data: stock } = await supabase
    .from("van_stock_summary")
    .select("product_id")
    .eq("van_id", assignment.van_id)
    .limit(1);

  if (!stock?.length) return { kind: "empty_van", vanCode, loadNumber };

  return { kind: "ready" };
}
