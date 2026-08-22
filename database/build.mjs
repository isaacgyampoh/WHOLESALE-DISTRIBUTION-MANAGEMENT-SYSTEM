/**
 * Generates the consolidated installer from supabase/migrations.
 *
 * The migrations remain the authoritative source; this file is derived,
 * never hand-edited. Regenerate with:  node database/build.mjs
 *
 * One transformation is required. The Supabase SQL Editor runs a script
 * inside a single transaction, and PostgreSQL refuses to use a new enum
 * value in the transaction that added it. Migration 0010 appends values
 * to user_role and movement_type which migrations 0011-0013 then use in
 * policy expressions, so a literal concatenation aborts partway through.
 *
 * For a fresh install the ALTERs are unnecessary: the enums are declared
 * complete up front, in the same order the migration path produces, and
 * 0010 becomes a no-op. Nothing else is altered.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { idempotentSql, splitStatements } from "./sqlgen.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, "..", "supabase", "migrations");
const OUT = path.join(here, "WHOLESALE_DISTRIBUTION_DATABASE.sql");

/**
 * Upgrade scripts, for a database installed before a given migration.
 *
 * Generated from the migration rather than written alongside it. The
 * first one of these was hand-patched and shipped with a duplicated enum
 * label, so the rule now is that no upgrade file is authored directly:
 * the migration is the source, and this turns it into something safe to
 * run against a database that already has some of it.
 */
const UPGRADES = [
  {
    migration: "0022_offline_sync.sql",
    out: "UPGRADE_0022_OFFLINE_SYNC.sql",
    title: "UPGRADE 0022 - offline operation and synchronisation",
    summary: `-- WHAT IT ADDS
--
--   sync_operations   one row per offline mutation, keyed by a uuid the
--                     device generates before queueing. That key is the
--                     primary key, so a retried upload cannot apply the
--                     same sale twice.
--   sync_submit()     the single entry point for a queued operation.
--                     Re-derives authorization from the calling session
--                     and never from the payload.
--   sync_bootstrap()  the snapshot a phone caches so it can keep
--                     selling with no signal.
--
-- The driver PWA does not work without this. Everything else in the
-- application does.`,
    verify: `select 'sync_operations table' as check,
       case when to_regclass('public.sync_operations') is not null
            then 'PASS' else 'FAIL' end as result
union all
select 'sync_status has exactly applied/failed/conflict',
       case when (
         select array_agg(e.enumlabel order by e.enumsortorder)
           from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'sync_status'
       ) = array['applied','failed','conflict']::name[]
            then 'PASS' else 'FAIL' end
union all
select 'row level security on',
       case when (select relrowsecurity from pg_class
                   where oid = 'public.sync_operations'::regclass)
            then 'PASS' else 'FAIL' end
union all
select 'sync_submit function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'sync_submit')
            then 'PASS' else 'FAIL' end
union all
select 'sync_bootstrap function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'sync_bootstrap')
            then 'PASS' else 'FAIL' end
union all
select 'history is append-only',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.sync_operations'::regclass
                            and tgname = 'sync_operations_no_edit')
            then 'PASS' else 'FAIL' end
union all
select 'authenticated cannot write it',
       case when not exists (
              select 1 from information_schema.role_table_grants
               where table_name = 'sync_operations' and grantee = 'authenticated'
                 and privilege_type in ('INSERT','UPDATE','DELETE'))
            then 'PASS' else 'FAIL' end;`,
  },
  {
    migration: "0023_cost_is_management_information.sql",
    out: "UPGRADE_0023_COST_SECURITY.sql",
    title: "UPGRADE 0023 - cost price is management information",
    summary: `-- WHAT IT CLOSES
--
-- A driver could read what the business pays for its goods:
--
--   select cost_price from products;
--   select stock_value from van_stock_summary;
--   select unit_cost from van_load_items;
--   select * from suppliers;
--
-- and the products screen rendered a Cost column to them. Every one of
-- those reads is available to anything holding the anon key and a
-- driver's session, so hiding the column in the interface would have
-- changed nothing.
--
-- WHAT IT ADDS
--
--   product_cost()     the one route to a cost figure. Returns NULL to
--                      any role outside admin, senior_manager, manager,
--                      accountant and warehouse.
--   products_priced    products with cost masked per caller. The
--                      application reads this instead of the table.
--
-- and it withdraws the raw cost columns from every Data API caller,
-- remasks stock_summary and van_stock_summary, and puts suppliers
-- behind the same roles.
--
-- AFTER RUNNING IT, redeploy the application. The version before this
-- reads products.cost_price directly and would fail on the products,
-- reports and warehouses screens.`,
    verify: `select 'product_cost function' as check,
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'product_cost')
            then 'PASS' else 'FAIL' end as result
union all
select 'products_priced view',
       case when to_regclass('public.products_priced') is not null
            then 'PASS' else 'FAIL' end
union all
select 'raw cost withheld from authenticated',
       case when not exists (
              select 1 from information_schema.column_privileges
               where table_name = 'products' and column_name = 'cost_price'
                 and grantee = 'authenticated' and privilege_type = 'SELECT')
            then 'PASS' else 'FAIL' end
union all
select 'the selling price is still readable',
       case when exists (
              select 1 from information_schema.column_privileges
               where table_name = 'products' and column_name = 'list_price'
                 and grantee = 'authenticated' and privilege_type = 'SELECT')
            then 'PASS' else 'FAIL' end
union all
select 'suppliers are role-gated',
       case when exists (
              select 1 from pg_policies
               where tablename = 'suppliers' and policyname = 'suppliers_read'
                 and qual like '%has_role%')
            then 'PASS' else 'FAIL' end;`,
  },
  {
    migration: "0024_batches_and_expiry.sql",
    out: "UPGRADE_0024_BATCHES_AND_EXPIRY.sql",
    title: "UPGRADE 0024 - batches and expiry",
    summary: `-- WHAT IT ADDS
--
-- The schema had no idea when anything went off. A distributor moving
-- food, drink and toiletries carries stock that expires, and the only
-- record of it was whatever somebody remembered.
--
--   product_batches          a delivery of one product, with the expiry
--                            it carries. Created at receiving, which is
--                            the only moment the date is known.
--   receive_purchase_batch() receiving, with the batch and expiry off
--                            the delivery note. Refuses a delivery that
--                            is already out of date.
--   batch_expiry_status      every batch with how long it has left.
--   expiry_summary           counts for the dashboard.
--   consume_batches()        draws stock down earliest expiry first.
--
-- and it replaces dispatch_van_load() so that no van leaves the yard
-- carrying stock that has expired.
--
-- NOTHING CHANGES BEHAVIOUR UNTIL YOU TURN IT ON. Tracking is per
-- product and off by default: a crate does not expire and is not made
-- to carry a date. Set it on the product screen.
--
-- AFTER RUNNING IT, redeploy the application, then run npm run demo:seed
-- again if you want the demonstration's expiry examples.`,
    verify: `select 'product_batches table' as check,
       case when to_regclass('public.product_batches') is not null
            then 'PASS' else 'FAIL' end as result
union all
select 'products carry tracking flags',
       case when (select count(*) from information_schema.columns
                   where table_name = 'products'
                     and column_name in ('track_batches','track_expiry','shelf_life_days')) = 3
            then 'PASS' else 'FAIL' end
union all
select 'tracking is off by default',
       case when (select column_default from information_schema.columns
                   where table_name = 'products' and column_name = 'track_expiry') like 'false%'
            then 'PASS' else 'FAIL' end
union all
select 'expiry needs a batch to live on',
       case when exists (select 1 from pg_constraint
                          where conname = 'products_expiry_needs_batches')
            then 'PASS' else 'FAIL' end
union all
select 'batch_expiry_status view',
       case when to_regclass('public.batch_expiry_status') is not null
            then 'PASS' else 'FAIL' end
union all
select 'expiry_summary view',
       case when to_regclass('public.expiry_summary') is not null
            then 'PASS' else 'FAIL' end
union all
select 'receive_purchase_batch function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'receive_purchase_batch')
            then 'PASS' else 'FAIL' end
union all
select 'dispatch refuses expired stock',
       case when (select pg_get_functiondef(p.oid) from pg_proc p
                    join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'dispatch_van_load')
                 like '%expired on%'
            then 'PASS' else 'FAIL' end
union all
select 'row level security on batches',
       case when (select relrowsecurity from pg_class
                   where oid = 'public.product_batches'::regclass)
            then 'PASS' else 'FAIL' end
union all
select 'the warning period is configurable',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'organizations'
                            and column_name = 'expiry_warning_days')
            then 'PASS' else 'FAIL' end;`,
  },
  {
    migration: "0025_sale_payment_methods.sql",
    out: "UPGRADE_0025_PAYMENT_METHODS.sql",
    title: "UPGRADE 0025 - how a sale was paid for",
    summary: `-- WHAT IT ADDS
--
-- A van sale recorded how much was paid and never how. \u20b5500 taken half
-- in cash and half on mobile money was indistinguishable from \u20b5500 in
-- notes - so end of day could only ever count cash, and a driver who
-- took momo looked short by exactly that amount every evening.
--
--   van_sale_payments      one row per method, so a split is two rows
--                          rather than a lost detail
--   record_sale_payments() records the breakdown. Refuses more than the
--                          sale is worth, and refuses a cash sale that
--                          is short.
--   load_takings           what a round took, cash and momo apart
--
-- and van_reconciliations gains expected_momo, actual_momo and
-- momo_variance, so the two are counted separately at end of day.
--
-- A round recorded before this change still reconciles: with no
-- breakdown, its takings are treated as cash, which is what they were
-- assumed to be at the time.
--
-- AFTER RUNNING IT, redeploy. The till offers Cash, Mobile money and
-- Split only once this is in place; before it, it offers cash and
-- credit exactly as it did.`,
    verify: `select 'van_sale_payments table' as check,
       case when to_regclass('public.van_sale_payments') is not null
            then 'PASS' else 'FAIL' end as result
union all
select 'record_sale_payments function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'record_sale_payments')
            then 'PASS' else 'FAIL' end
union all
select 'load_takings view',
       case when to_regclass('public.load_takings') is not null
            then 'PASS' else 'FAIL' end
union all
select 'reconciliation counts momo apart',
       case when (select count(*) from information_schema.columns
                   where table_name = 'van_reconciliations'
                     and column_name in ('expected_momo','actual_momo','momo_variance')) = 3
            then 'PASS' else 'FAIL' end
union all
select 'row level security on the breakdown',
       case when (select relrowsecurity from pg_class
                   where oid = 'public.van_sale_payments'::regclass)
            then 'PASS' else 'FAIL' end
union all
select 'nobody writes a payment by hand',
       case when not exists (
              select 1 from information_schema.role_table_grants
               where table_name = 'van_sale_payments' and grantee = 'authenticated'
                 and privilege_type in ('INSERT','UPDATE','DELETE'))
            then 'PASS' else 'FAIL' end;`,
  },
  {
    migration: "0026_invoices_receipts_waybills.sql",
    out: "UPGRADE_0026_DOCUMENTS.sql",
    title: "UPGRADE 0026 - invoices, receipts and waybills",
    summary: `-- WHAT IT ADDS
--
-- The invoices and payments tables have been in this schema since the
-- beginning and nothing has ever written to them. That is why the
-- Credit screen, which reads invoice_ageing, has always been empty
-- however much the business was owed.
--
-- This connects them to the sales that are already happening:
--
--   a credit sale now raises an invoice by itself, on completion, with
--   a due date taken from that customer's own payment terms. By
--   trigger, so it cannot be forgotten and offline sales get one too.
--
--   a collection now settles invoices oldest first and writes a payment
--   against each, which is what a receipt is printed from. Money beyond
--   what is owed stays on account rather than being forced onto an
--   invoice that does not exist yet.
--
--   waybills / waybill_items    the document that travels with the
--                               goods, and issue_waybill_for_load() to
--                               raise one for a dispatched van.
--
--   invoice_detail, receipt_detail   everything a printed copy needs.
--                                    Neither carries cost price.
--
-- Existing data is left alone. Credit sales completed before this runs
-- have no invoice; their debt is still on the customer ledger exactly
-- as before, and the ageing report covers sales from here on. Nothing
-- is double counted: credit_transactions stays the running balance the
-- credit limit is checked against, and invoices are the documents.
--
-- AFTER RUNNING IT, redeploy. Invoices, receipts and waybills appear in
-- the application only once this is in place.`,
    verify: `select 'invoices linked to van sales' as check,
       case when exists (select 1 from information_schema.columns
                          where table_name = 'invoices' and column_name = 'van_sale_id')
            then 'PASS' else 'FAIL' end as result
union all
select 'one invoice per sale',
       case when exists (select 1 from pg_indexes
                          where schemaname = 'public' and indexname = 'invoices_one_per_sale')
            then 'PASS' else 'FAIL' end
union all
select 'a completed credit sale raises one',
       case when exists (select 1 from pg_trigger
                          where tgname = 'van_sales_raise_invoice')
            then 'PASS' else 'FAIL' end
union all
select 'issue_invoice_for_sale function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'issue_invoice_for_sale')
            then 'PASS' else 'FAIL' end
union all
select 'waybills table',
       case when to_regclass('public.waybills') is not null
            then 'PASS' else 'FAIL' end
union all
select 'waybill_items table',
       case when to_regclass('public.waybill_items') is not null
            then 'PASS' else 'FAIL' end
union all
select 'issue_waybill_for_load function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'issue_waybill_for_load')
            then 'PASS' else 'FAIL' end
union all
select 'row level security on the paperwork',
       case when (select bool_and(relrowsecurity) from pg_class
                   where oid in ('public.waybills'::regclass,
                                 'public.waybill_items'::regclass))
            then 'PASS' else 'FAIL' end
union all
select 'printable views',
       case when to_regclass('public.invoice_detail') is not null
             and to_regclass('public.receipt_detail') is not null
            then 'PASS' else 'FAIL' end
union all
select 'no cost price on a customer document',
       case when not exists (
              select 1 from information_schema.columns
               where table_name in ('invoice_detail','receipt_detail')
                 and column_name ilike '%cost%')
            then 'PASS' else 'FAIL' end
union all
select 'a driver cannot write a waybill',
       case when exists (select 1 from pg_policies
                          where tablename = 'waybills' and policyname = 'waybills_write'
                            and with_check like '%has_role%')
            then 'PASS' else 'FAIL' end;`,
  },
  {
    migration: "0027_warehouse_transfers.sql",
    out: "UPGRADE_0027_TRANSFERS.sql",
    title: "UPGRADE 0027 - moving stock between warehouses",
    summary: `-- WHAT IT ADDS
--
-- stock_transfers has been in the schema since 0011 and nothing ever
-- used it. Stock moved between depots as an adjustment out of one and
-- an adjustment in to the other - which balances, and is wrong in every
-- other way: no document joins the two, nothing is in transit, nobody
-- is accountable for the gap, and the stock report shows two
-- unexplained corrections instead of one movement.
--
-- A transfer becomes a lifecycle: draft, approved, in transit,
-- received. Approving and dispatching are separate jobs, so a depot
-- cannot move stock on its own say-so, and what arrives is counted
-- rather than assumed.
--
--   approve_stock_transfer()   manager and above only
--   dispatch_stock_transfer()  takes the goods off the source warehouse
--   receive_stock_transfer()   books in what was actually counted
--   cancel_stock_transfer()    while it has not yet left
--   stock_transfer_summary     what left, what arrived, and the gap
--   stock_in_transit           goods that belong to neither depot
--
-- Batches keep their expiry dates across the journey, and expired stock
-- is refused: transferring it would only relocate the write-off.
--
-- ONE EXISTING RULE IS WIDENED. The uniqueness of a batch number was
-- (organization, product); it is now (organization, product,
-- warehouse). A delivery of 500 split 300 to one depot and 200 to
-- another genuinely is the same batch in two places, and the old rule
-- could not say so. This permits more than before, so nothing that was
-- valid becomes invalid.
--
-- Existing data is untouched. Transfers recorded as adjustments stay as
-- they are; the stock they moved is already where it should be.
--
-- AFTER RUNNING IT, redeploy. The transfer screens appear only once
-- this is in place.`,
    verify: `select 'transfer lifecycle' as check,
       case when exists (
              select 1 from pg_constraint
               where conrelid = 'public.stock_transfers'::regclass
                 and conname = 'stock_transfers_status_check'
                 and pg_get_constraintdef(oid) like '%approved%')
            then 'PASS' else 'FAIL' end as result
union all
select 'approve_stock_transfer function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'approve_stock_transfer')
            then 'PASS' else 'FAIL' end
union all
select 'dispatch_stock_transfer function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'dispatch_stock_transfer')
            then 'PASS' else 'FAIL' end
union all
select 'receive_stock_transfer function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'receive_stock_transfer')
            then 'PASS' else 'FAIL' end
union all
select 'what arrived is recorded',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'stock_transfer_items'
                            and column_name = 'qty_received')
            then 'PASS' else 'FAIL' end
union all
select 'stock_transfer_summary view',
       case when to_regclass('public.stock_transfer_summary') is not null
            then 'PASS' else 'FAIL' end
union all
select 'stock_in_transit view',
       case when to_regclass('public.stock_in_transit') is not null
            then 'PASS' else 'FAIL' end
union all
select 'a batch can be in two warehouses',
       case when (select indexdef from pg_indexes
                   where schemaname = 'public' and indexname = 'product_batches_unique')
            like '%warehouse_id%'
            then 'PASS' else 'FAIL' end;`,
  },
  {
    migration: "0028_notifications.sql",
    out: "UPGRADE_0028_NOTIFICATIONS.sql",
    title: "UPGRADE 0028 - telling people what needs them",
    summary: `-- WHAT IT ADDS
--
-- Everything the system knows was already on a screen somewhere, which
-- is the problem: a reconciliation submitted at seven in the evening
-- sits on the reconciliation screen, and nobody opens that screen
-- unless they already suspect something is on it.
--
-- Two things get called a notification and they behave differently, so
-- both are here rather than one pretending to be the other:
--
--   an EVENT happened once and stays true - a driver closed their day,
--   a transfer is waiting for approval. Written by trigger when it
--   happens, and marked read by a person.
--
--   a CONDITION is true until it is not - stock below reorder, an
--   invoice past due. Nobody reads one of these away; it ends when the
--   stock is replenished or the invoice is paid.
--
-- Conditions are refreshed rather than appended: one row per subject,
-- updated in place and cleared when the condition stops. So there is no
-- scheduler to install - refresh_standing_alerts() is called by the
-- dashboard, which is where somebody is about to read the answer.
--
-- Notifications are addressed to a job rather than to a person, because
-- 'a transfer needs approving' is for whoever is managing today and not
-- for one named manager who might be on leave. Each role sees only what
-- is addressed to it, and nobody can write one: a notification a
-- browser could insert is a way to report something that did not
-- happen.
--
-- AFTER RUNNING IT, redeploy. The bell appears only once this is in
-- place.`,
    verify: `select 'notifications table' as check,
       case when to_regclass('public.notifications') is not null
            then 'PASS' else 'FAIL' end as result
union all
select 'a condition is one row, not one a day',
       case when exists (select 1 from pg_indexes
                          where schemaname = 'public'
                            and indexname = 'notifications_standing_unique')
            then 'PASS' else 'FAIL' end
union all
select 'refresh_standing_alerts function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'refresh_standing_alerts')
            then 'PASS' else 'FAIL' end
union all
select 'events are written by trigger',
       case when (select count(*) from pg_trigger
                   where tgname in ('reconciliations_notify','van_returns_notify',
                                    'stock_transfers_notify','stock_transfers_notify_short')) = 4
            then 'PASS' else 'FAIL' end
union all
select 'row level security on',
       case when (select relrowsecurity from pg_class
                   where oid = 'public.notifications'::regclass)
            then 'PASS' else 'FAIL' end
union all
select 'nobody writes their own',
       case when not exists (
              select 1 from information_schema.role_table_grants
               where table_name = 'notifications' and grantee = 'authenticated'
                 and privilege_type in ('INSERT','DELETE'))
            then 'PASS' else 'FAIL' end;`,
  },
];

/** Final enum members, in the order `alter type ... add value` yields. */
const ENUM_REWRITES = [
  {
    file: "0001_foundation.sql",
    from: `create type public.user_role as enum (
  'admin', 'manager', 'sales_rep', 'warehouse', 'accountant'
);`,
    to: `create type public.user_role as enum (
  'admin', 'manager', 'sales_rep', 'warehouse', 'accountant',
  -- Appended by migration 0010; declared here so the whole installer can
  -- run inside one transaction.
  'driver', 'senior_manager'
);`,
  },
  {
    file: "0001_foundation.sql",
    from: `create type public.movement_type as enum (
  'receipt', 'issue', 'adjustment_in', 'adjustment_out',
  'transfer_in', 'transfer_out', 'customer_return', 'supplier_return'
);`,
    to: `create type public.movement_type as enum (
  'receipt', 'issue', 'adjustment_in', 'adjustment_out',
  'transfer_in', 'transfer_out', 'customer_return', 'supplier_return',
  -- Appended by migration 0010, as above.
  'damage', 'shortage'
);`,
  },
];

const NEUTRALISED = {
  "0010_enum_extensions.sql": `-- Migration 0010 appends values to user_role and movement_type.
-- In this consolidated installer those values are already part of the
-- enum declarations in section 0001, because PostgreSQL cannot use a new
-- enum value in the transaction that added it. Nothing to do here.`,
};

const banner = (title) =>
  `\n\n-- ${"=".repeat(68)}\n-- ${title}\n-- ${"=".repeat(68)}\n`;

const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
let applied = 0;
const parts = [];

for (const file of files) {
  let sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");

  if (NEUTRALISED[file]) {
    parts.push(banner(file) + NEUTRALISED[file] + "\n");
    continue;
  }

  for (const rule of ENUM_REWRITES) {
    if (rule.file !== file) continue;
    if (!sql.includes(rule.from)) {
      throw new Error(
        `Enum rewrite target not found in ${file}. The migration has changed; ` +
          `update database/build.mjs rather than editing the installer.`,
      );
    }
    sql = sql.replace(rule.from, rule.to);
    applied++;
  }

  parts.push(banner(file) + sql.trimEnd() + "\n");
}

if (applied !== ENUM_REWRITES.length) {
  throw new Error(`Expected ${ENUM_REWRITES.length} enum rewrites, applied ${applied}`);
}

const header = `-- =====================================================================
-- WHOLESALE DISTRIBUTION MANAGEMENT SYSTEM
-- Complete database installer for a fresh Supabase project
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0001 .. 0015
-- Regenerate: node database/build.mjs
--
-- HOW TO INSTALL
--   1. Open your Supabase project, then SQL Editor.
--   2. New query, paste this entire file, Run.
--   3. Run database/VERIFY_DATABASE.sql to confirm the result.
--   4. Create your first user in Authentication, then promote them:
--        update public.profiles set role = 'admin' where email = 'you@example.com';
--
-- WHAT THIS DOES NOT DO
--   It does not create auth.users. Supabase provides that schema, and a
--   trigger installed here creates a public.profiles row whenever a user
--   signs up. Running this against a database without Supabase Auth will
--   fail on that reference, which is intended.
--
-- SAFE TO RUN ON A FRESH PROJECT ONLY. It creates objects; it does not
-- drop an existing installation.
-- =====================================================================
`;

// The installer is for an empty project, but a CREATE TYPE that meets an
// existing type aborts the whole transaction with nothing to say about
// which one. Guarding them turns that into a message naming the type and
// both label lists. It does not make the installer re-runnable - the
// tables would still collide - it makes the failure legible.
const installer = idempotentSql(header + parts.join("") + "\n");
fs.writeFileSync(OUT, installer);

// ---- upgrade scripts, from the same migrations -----------------------
const upgradeSummaries = [];
for (const upgrade of UPGRADES) {
  const source = path.join(MIGRATIONS, upgrade.migration);
  if (!fs.existsSync(source)) {
    throw new Error(`Upgrade ${upgrade.out} names a migration that does not exist: ${upgrade.migration}`);
  }

  const body = idempotentSql(fs.readFileSync(source, "utf8"));
  const bar = "-- " + "=".repeat(68);
  const text = `${bar}
-- ${upgrade.title}
${bar}
--
-- For a database installed before migration ${upgrade.migration.slice(0, 4)}.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/${upgrade.migration}
-- Regenerate: node database/build.mjs
--
-- Safe to run twice. Every object is created behind an existence check,
-- so a second run reports success and changes nothing. An enum that
-- already exists is compared against what this script expects and the
-- script stops with both lists if they differ, rather than altering a
-- type other code may already depend on.
--
${upgrade.summary}

${body.trim()}

${bar}
-- Confirm it took. Every row should read PASS.
${bar}
${upgrade.verify}
`;

  const outPath = path.join(here, upgrade.out);
  fs.writeFileSync(outPath, text);
  upgradeSummaries.push(`  ${upgrade.out}  ${(text.length / 1024).toFixed(1)} KB`);
}

const text = fs.readFileSync(OUT, "utf8");
const leftovers = text.match(/alter type[^;]*add value/gi) ?? [];
if (leftovers.length) {
  throw new Error(`Installer still contains ${leftovers.length} enum ALTER(s); it cannot run in one transaction.`);
}

console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
console.log(`  source migrations: ${files.length}`);
console.log(`  enum rewrites applied: ${applied}`);
console.log(`  size: ${(text.length / 1024).toFixed(1)} KB, ${text.split("\n").length} lines`);
console.log(`  residual "alter type ... add value": ${leftovers.length}`);

// A duplicated enum label is what broke the first upgrade script. It is
// cheap to prove it cannot ship again.
for (const statement of splitStatements(text)) {
  const enumDecl = /create type public\.([a-z_]+) as enum \(([^)]*)\)/i.exec(statement);
  if (!enumDecl) continue;
  const labels = [...enumDecl[2].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const dup = labels.find((l, i) => labels.indexOf(l) !== i);
  if (dup) throw new Error(`Installer enum ${enumDecl[1]} repeats '${dup}'.`);
}

if (upgradeSummaries.length) {
  console.log(`\nwrote ${upgradeSummaries.length} upgrade script(s):`);
  for (const line of upgradeSummaries) console.log(line);
}
