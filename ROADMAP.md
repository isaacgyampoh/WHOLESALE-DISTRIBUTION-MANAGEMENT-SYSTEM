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
| Phase 4 — Hosted gate (part 1) | Partial | GitHub pushed; hosted project pending |

## Verified database state

29 tables · 8 views · 5 enums · RLS on all 29 tables.
**137 assertions across 7 suites, 0 failures** (`npm run db:test`).
Migration 0015 adds Data API grants and closes an anonymous
authorization bypass; policy and trigger counts change accordingly.

## Not started

Phases 4-20: authentication hardening, products, warehouses, inventory,
vans, drivers, van loading, customers, cash sales, credit sales, payments,
van returns, reconciliation, manager scopes UI, reports, driver PWA,
offline sync, security hardening, production deployment.

## Open risks

| Risk | Impact | Status |
|---|---|---|
| Nothing pushed to GitHub; remote has zero branches | — | RESOLVED: `main` pushed, 9 commits, 15 migrations on remote |
| Migrations never run against hosted Supabase | Platform behaviour (PostgREST, Auth, storage) unproven | Blocked on project credentials |
| No `supabase/config.toml` | — | RESOLVED: added, parses, `db push` idempotent |
| Auth flow untested end to end | Sign-in renders; no credential has been exchanged | Blocked on `.env.local` |
| Hosted gate suite never executed | 60+ assertions written, none run | Blocked on `.env.local` |

## Technical debt

- `tests/db` is excluded from the Next ESLint config; it has no linter of its own.
- No unit/integration test runner for application code yet (Vitest/Playwright not installed).
- Design system covers the primitives in use; modal, drawer, tabs, toast and
  pagination are not built yet.

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
