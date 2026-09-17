/**
 * Merge the CHOICE warehouse into WEIJA.
 *
 * The business is consolidating to one warehouse. Everything CHOICE
 * holds moves to WEIJA, and CHOICE stops being somewhere anyone can
 * sell from, load from, or count.
 *
 * WHY THE STOCK MOVES AS A TRANSFER
 *
 * Not an UPDATE of inventory.warehouse_id. That would teleport 547
 * units across town with nothing in the ledger to say it happened, and
 * the next stocktake would find WEIJA holding goods no document ever
 * delivered. The system already has the right instrument - approve,
 * dispatch, receive - which writes transfer_out at CHOICE and
 * transfer_in at WEIJA, leaves the goods in transit in between, and
 * draws the batches down on the way. This uses it exactly as a
 * warehouse manager would.
 *
 * WHY CHOICE IS DEACTIVATED AND NOT DELETED
 *
 * 88 stock movements, 27 transfers and 2 counter sales point at CHOICE,
 * and eleven of the fourteen foreign keys into `warehouses` are
 * RESTRICT - so the database refuses the DELETE, which is the
 * protection working. Forcing it would mean rewriting those rows to
 * claim the goods were at WEIJA all along: not a migration, a
 * falsified history, and the opposite of losing nothing.
 *
 * Deactivating gets what was actually asked for. Every warehouse
 * selector in the application already filters on is_active, and
 * recordVanSaleAction refuses an inactive warehouse outright, so WEIJA
 * becomes the only warehouse anyone can choose. What stays is the past
 * tense: the ledger goes on saying where goods really were.
 *
 * THE SIX STALE TRANSFERS
 *
 * Somebody began this merge by hand and stopped. Six transfers sit
 * approved-but-undispatched, all CHOICE -> WEIJA, the newest from
 * yesterday - and twelve of their thirteen lines ask for stock CHOICE
 * no longer has, because it has been sold or moved since. Dispatching
 * them would fail on the first line. They are cancelled with a reason,
 * and the one transfer this script raises carries what is actually on
 * the shelf today.
 *
 *   node scripts/db/merge_choice_into_weija.mjs            # dry run
 *   node scripts/db/merge_choice_into_weija.mjs --confirm  # do it
 *
 * Everything runs in one transaction and every figure is checked
 * afterwards. A single assertion failing rolls the whole thing back.
 */
import { connectHosted, explainFailure } from "./hosted.mjs";

const confirm = process.argv.includes("--confirm");
/*
 * A full run against the real data that is thrown away at the end.
 *
 * Every function this calls is a definer function with its own checks,
 * and the only honest rehearsal is against the rows it will actually
 * meet. So it does the whole thing - cancels, raises, approves,
 * dispatches, receives, deactivates - verifies every figure, and then
 * rolls back whatever the result. Nothing is written either way.
 */
const rehearse = process.argv.includes("--rehearse");

const { client, failures } = await connectHosted();
if (!client) {
  console.error(explainFailure(failures));
  process.exit(1);
}

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await client.query(sql, params)).rows;

/** Units and loose pieces held at one warehouse. */
const held = async (id) => {
  const r = await one(
    `select coalesce(sum(qty_on_hand),0)::int units,
            coalesce(sum(qty_pieces),0)::int pieces,
            coalesce(sum(qty_reserved),0)::int reserved
       from inventory where warehouse_id = $1`, [id]);
  return { units: r.units, pieces: r.pieces, reserved: r.reserved };
};

const say = (label, v) =>
  console.log(`  ${label.padEnd(26)} ${String(v.units).padStart(6)} units` +
              `  ${String(v.pieces).padStart(5)} pieces`);

try {
  const choice = await one(`select id, name from warehouses where name = 'CHOICE'`);
  const weija = await one(`select id, name from warehouses where name = 'WEIJA'`);
  if (!choice || !weija) throw new Error("Expected warehouses CHOICE and WEIJA to exist.");

  const admin = await one(
    `select id, full_name from profiles where role = 'admin' order by created_at limit 1`);
  if (!admin) throw new Error("No administrator to attribute the merge to.");

  // ---- before ----------------------------------------------------
  const beforeChoice = await held(choice.id);
  const beforeWeija = await held(weija.id);
  const beforeTotal = await one(
    `select coalesce(sum(qty_on_hand),0)::int units,
            coalesce(sum(qty_pieces),0)::int pieces from inventory`);
  const beforeMovements = (await one(`select count(*)::int n from stock_movements`)).n;
  const beforeSales = (await one(`select count(*)::int n from van_sales`)).n;

  console.log("\nBefore:");
  say("CHOICE holds", beforeChoice);
  say("WEIJA holds", beforeWeija);
  say("both together", beforeTotal);
  console.log(`  ${String(beforeMovements).padStart(6)} stock movements, ${beforeSales} sales`);

  if (beforeChoice.reserved !== 0) {
    throw new Error(
      `CHOICE has ${beforeChoice.reserved} units reserved against open orders. ` +
      `Those have to be settled before it can be emptied.`);
  }

  // What is actually on CHOICE's shelf today.
  const lines = await all(
    `select i.product_id, p.sku, p.name,
            i.qty_on_hand::int units, coalesce(i.qty_pieces,0)::int pieces
       from inventory i join products p on p.id = i.product_id
      where i.warehouse_id = $1 and (i.qty_on_hand > 0 or coalesce(i.qty_pieces,0) > 0)
      order by p.name`, [choice.id]);

  const stale = await all(
    `select id, transfer_number from stock_transfers
      where status = 'approved' and from_warehouse_id = $1`, [choice.id]);

  console.log(`\nTo move: ${lines.length} product lines, ` +
              `${beforeChoice.units} units, ${beforeChoice.pieces} pieces`);
  console.log(`To cancel: ${stale.length} stale approved transfer(s) ` +
              `(${stale.map((t) => t.transfer_number).join(", ") || "none"})`);

  if (!confirm && !rehearse) {
    console.log("\nDry run. Nothing was written. Pass --rehearse to try it for real and");
    console.log("roll back, or --confirm to carry it out.");
    await client.end();
    process.exit(0);
  }

  // ---- one transaction, attributed to the administrator -----------
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ sub: admin.id, role: "authenticated" })]);
  await client.query("set local role authenticated");

  for (const t of stale) {
    await client.query(`select public.cancel_stock_transfer($1, $2)`, [t.id,
      "Superseded by the consolidation of CHOICE into WEIJA. The quantities on "
      + "this transfer were approved days ago and are no longer on the shelf."]);
  }
  console.log(`\n  cancelled ${stale.length} stale transfer(s)`);

  let transfer = null;
  if (lines.length) {
    transfer = await one(
      `insert into stock_transfers
         (org_id, from_warehouse_id, to_warehouse_id, status, transfer_date, notes, created_by)
       select p.org_id, $1, $2, 'draft', current_date, $3, $4
         from profiles p where p.id = $4
       returning id, transfer_number`,
      [choice.id, weija.id,
       "Consolidation: CHOICE is closing and everything it holds moves to WEIJA.",
       admin.id]);

    for (const l of lines) {
      await client.query(
        `insert into stock_transfer_items (org_id, transfer_id, product_id, quantity, pieces)
         select t.org_id, $1, $2, $3, $4 from stock_transfers t where t.id = $1`,
        [transfer.id, l.product_id, l.units, l.pieces]);
    }

    await client.query(`select public.approve_stock_transfer($1)`, [transfer.id]);
    await client.query(`select public.dispatch_stock_transfer($1)`, [transfer.id]);
    await client.query(`select public.receive_stock_transfer($1, '[]'::jsonb)`, [transfer.id]);
    console.log(`  raised, approved, dispatched and received ${transfer.transfer_number}`);
  }

  // CHOICE stops being a place anyone can choose.
  await client.query(`update warehouses set is_active = false, updated_at = now() where id = $1`,
    [choice.id]);
  console.log("  CHOICE deactivated");

  // ---- after, and every figure checked ---------------------------
  const afterChoice = await held(choice.id);
  const afterWeija = await held(weija.id);
  const afterTotal = await one(
    `select coalesce(sum(qty_on_hand),0)::int units,
            coalesce(sum(qty_pieces),0)::int pieces from inventory`);
  const afterSales = (await one(`select count(*)::int n from van_sales`)).n;
  const activeNames = (await all(
    `select name from warehouses where is_active order by name`)).map((w) => w.name);

  console.log("\nAfter:");
  say("CHOICE holds", afterChoice);
  say("WEIJA holds", afterWeija);
  say("both together", afterTotal);

  const checks = [
    ["CHOICE is empty",
     afterChoice.units === 0 && afterChoice.pieces === 0,
     `${afterChoice.units} units, ${afterChoice.pieces} pieces left`],
    ["WEIJA gained exactly what CHOICE had",
     afterWeija.units === beforeWeija.units + beforeChoice.units
     && afterWeija.pieces === beforeWeija.pieces + beforeChoice.pieces,
     `${beforeWeija.units}+${beforeChoice.units} should be ${afterWeija.units}`],
    ["not one unit was created or lost",
     afterTotal.units === beforeTotal.units && afterTotal.pieces === beforeTotal.pieces,
     `${beforeTotal.units} -> ${afterTotal.units} units`],
    ["no sale was touched", afterSales === beforeSales, `${beforeSales} -> ${afterSales}`],
    ["the history still points at CHOICE",
     (await one(`select count(*)::int n from stock_movements where warehouse_id = $1`,
       [choice.id])).n >= 88, "movements at CHOICE preserved"],
    ["WEIJA is the only warehouse anyone can choose",
     activeNames.length === 1 && activeNames[0] === "WEIJA", activeNames.join(", ")],
  ];

  console.log("");
  let bad = 0;
  for (const [name, passed, detail] of checks) {
    console.log(`  ${passed ? "OK  " : "FAIL"}  ${name}${passed ? "" : `  (${detail})`}`);
    if (!passed) bad++;
  }

  if (bad) {
    await client.query("rollback");
    console.error(`\n${bad} check(s) failed. Everything has been rolled back; nothing changed.`);
    process.exit(1);
  }

  if (rehearse) {
    await client.query("rollback");
    console.log("\nRehearsal. Every check passed and the whole thing was rolled back;");
    console.log("nothing changed. Run again with --confirm to keep it.");
  } else {
    await client.query("commit");
    console.log("\nCommitted. One warehouse: WEIJA.");
  }
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error("\nFailed, and rolled back. Nothing changed.");
  console.error(`  ${e.message}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
