import type { UserRole } from "./domain";

/**
 * Permissions, not role-name checks.
 *
 * UI and service code asks "can this user do X", never "is this user a
 * manager". Role names change; capabilities are stable. This map is the
 * single place roles turn into capabilities.
 *
 * This governs what the interface offers. It is NOT the security
 * boundary: the database enforces the same rules through RLS and through
 * the authorization checks inside SECURITY DEFINER functions. A user who
 * forges a request past this map still hits the database's own rules.
 */
export const PERMISSIONS = [
  // Every signed-in user has a home screen.
  "dashboard.view",
  "products.view", "products.create", "products.edit",
  "inventory.view", "inventory.transfer", "inventory.adjust", "inventory.count",
  "vans.view", "vans.manage",
  // Held by the crew of a van - the driver who answers for it and the
  // salesperson who sells from it. Not by a manager, whose "my van" is
  // empty by definition.
  "vans.crew",
  "loads.view", "loads.create", "loads.dispatch", "loads.confirm",
  "customers.view", "customers.create", "customers.edit",
  "sales.view", "sales.create",
  "credit.view", "credit.approve", "credit.override",
  "payments.view", "payments.create",
  "returns.view", "returns.submit", "returns.approve",
  "reconciliation.view", "reconciliation.submit", "reconciliation.approve",
  "reports.view",
  "users.manage", "roles.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: ALL,
  senior_manager: ALL.filter((p) => p !== "roles.manage"),
  manager: [
    "dashboard.view",
    "products.view", "products.create", "products.edit",
    "inventory.view", "inventory.transfer", "inventory.adjust", "inventory.count",
    "vans.view", "vans.manage",
    "loads.view", "loads.create", "loads.dispatch",
    "customers.view", "customers.create", "customers.edit",
    "sales.view", "sales.create",
    "credit.view", "credit.approve",
    "payments.view", "payments.create",
    "returns.view", "returns.approve",
    "reconciliation.view", "reconciliation.approve",
    "reports.view",
  ],
  warehouse: [
    "dashboard.view",
    "products.view",
    "inventory.view", "inventory.transfer", "inventory.adjust", "inventory.count",
    "vans.view",
    "loads.view", "loads.create", "loads.dispatch",
    "customers.view",
    "sales.view",
    "returns.view", "returns.approve",
    "reports.view",
  ],
  accountant: [
    "dashboard.view",
    "products.view", "inventory.view", "vans.view", "loads.view",
    "customers.view",
    "sales.view",
    "credit.view", "credit.approve",
    "payments.view", "payments.create",
    "returns.view",
    "reconciliation.view",
    "reports.view",
  ],
  sales_rep: [
    "dashboard.view",
    "products.view",
    "inventory.view",
    // A field salesperson is crew: their stock is the van they are on.
    // An in-shop salesperson holds the same permission and simply has no
    // van, which the database resolves for them.
    "vans.crew",
    "customers.view", "customers.create", "customers.edit",
    "sales.view", "sales.create",
    "credit.view",
    "payments.view",
    "reports.view",
  ],
  // A driver keeps the van and answers for what is on it. They do not
  // sell: sales.create is deliberately absent, and the database refuses
  // a sale from a driver regardless of what this map says.
  driver: [
    "dashboard.view",
    "products.view",
    "vans.view", "vans.crew",
    "loads.view", "loads.confirm",
    "customers.view", "customers.create",
    "sales.view",
    "credit.view",
    "payments.view", "payments.create",
    "returns.view", "returns.submit",
    "reconciliation.view", "reconciliation.submit",
  ],
};

export function permissionsFor(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(role: UserRole, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

export function canAny(role: UserRole, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}
