# Implementation roadmap

Tracks the phases in the master development prompt. Updated as work lands.

## Complete

| Phase | Status | Verification |
|---|---|---|
| Database foundation (0001-0008) | Done | Executed against PostgreSQL 17.10 |
| Multi-tenancy (0009) | Done | 22 isolation assertions |
| Van distribution schema (0010-0014) | Done | 34 workflow assertions |
| Phase 1 — Inspection & architecture | Done | See "Assessment" below |
| Phase 2 — Next.js foundation | Done | `npm run verify` passes |
| Phase 3 — Design system (core) | Partial | Tokens, primitives, shell built |
| Phase 5A — Auth & application shell | Done | 44 assertions against hosted Supabase |
| Phase 5B — Staff, roles, permissions, audit trail | Done | 26 database assertions; screens audited at 6 viewports |
| Phase 6 — Catalogue: products, categories, stock, movements | Done | 27 database assertions; 15 end-to-end assertions through the browser |
| Phase 7 — Every remaining screen: warehouses, purchasing, vans, loads, returns, reconciliation, customers, sales, credit, collections, reports, settings | Done | 103 route assertions across 4 roles |
| Phase 8 — Write workflows: purchase orders and receiving, van loads and dispatch, returns, reconciliation, customers, vans, warehouses, suppliers | Done | Server actions over the database functions that own each rule |
| Phase 9 — Driver PWA and offline synchronisation | Done | 30 database assertions; 16 browser assertions with the network genuinely cut |
| Phase 4 — Hosted gate (part 1) | Partial | GitHub pushed; hosted CLI path abandoned |
| Consolidated SQL installer | Done | Installed into a fresh database and compared object-by-object |

## Verified database state

32 tables · 8 views · 14 enums · 40 functions · RLS on all 32 tables.
**279 assertions across 13 suites, 0 failures** (`npm run db:test`).
Migration 0015 adds Data API grants and closes an anonymous
authorization bypass; policy and trigger counts change accordingly.
Migration 0019 adds the audit trail, 0020 adds category status and
withdraws the privilege to write `inventory` directly, so quantity can
only move through the ledger. 0021 lets a trusted server-side role
delete audit rows so a tenant can be removed at all; rewriting an entry
stays impossible for every caller. 0022 adds the offline sync engine:
`sync_operations` keyed on a device-generated uuid, so a retried upload
cannot apply the same sale twice.

## Not started

Production deployment, which is the owner's to perform:
`docs/SUPABASE_SETUP.md`, `docs/VERCEL_DEPLOYMENT.md`.

Every navigation destination resolves to a real screen backed by real
queries, and every workflow can be driven from the interface.
`npm run hosted:pages` asserts the first for each role.

Business rules stay in the database. The screens assemble rows and call
the function that owns the rule — `dispatch_van_load`,
`complete_van_sale`, `receive_purchase_line`, `approve_van_return`,
`build_reconciliation`, `record_credit_payment`. The offline sync path
calls the same functions, so a sale made in a tunnel and one made at a
desk go through identical logic.

## Open risks

| Risk | Impact | Status |
|---|---|---|
| Nothing pushed to GitHub; remote has zero branches | — | RESOLVED: `main` pushed, 20 migrations in the tree |
| Migrations never run against hosted Supabase | — | RESOLVED: 0001-0020 installed and verified on the hosted project |
| No `supabase/config.toml` | — | RESOLVED: added, parses, `db push` idempotent |
| Auth flow untested end to end | — | RESOLVED: 20 auth + 24 shell assertions against the hosted project |
| Hosted gate suite never executed | 60+ assertions written, none run | Superseded: deployment is now by SQL installer |
| Hosted install not yet performed by the owner | — | RESOLVED: installed, verified, anon privileges repaired |

## Technical debt

- `tests/db` is excluded from the Next ESLint config; it has no linter of its own.
- No unit/integration test runner for application code yet (Vitest not installed).
  Playwright drives the browser suites in `tests/visual`, but nothing covers
  server actions or query modules in isolation.
- Design system covers the primitives in use; dialog and pagination are now
  built, drawer, tabs and toast are not.
- The end-to-end suites (`hosted:workflow`, `hosted:pages`, `visual:audit`)
  need the application running and write to the hosted project. They are not
  part of `npm run verify`.
- Stock transfers between warehouses exist in the schema
  (`stock_transfers`) but have no screen. Movement between warehouses is
  currently done as an adjustment out and an adjustment in, which is
  auditable but does not link the two halves.
- The offline snapshot persists in IndexedDB until browser data is
  cleared. The shell cache is emptied at sign-in; the queue deliberately
  is not, because unsent work must survive a sign-out.

## Architectural rules established

1. **SECURITY DEFINER functions must re-assert authorization.** They bypass RLS.
   Every such function calls `require_role()`. New ones need authorization tests.
2. **Stock is derived, never set.** All changes go through `stock_movements`,
   which is append-only. Corrections are reversing movements.
3. **Supabase stays behind a boundary.** Business logic imports from
   `@/lib/auth`, `@/types/domain` and feature query modules — never from
   `@supabase/*` directly. Only `src/lib/supabase/*` names the provider.
4. **Permissions, not role names.** UI and services ask `can(role, permission)`.
   This governs what is offered; the database governs what is allowed.
