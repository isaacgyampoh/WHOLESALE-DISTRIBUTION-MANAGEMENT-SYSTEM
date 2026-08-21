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
  "products.view", "products.create", "products.edit",
  "inventory.view", "inventory.transfer", "inventory.adjust",
  "vans.view", "vans.manage",
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
    "products.view", "products.create", "products.edit",
    "inventory.view", "inventory.transfer", "inventory.adjust",
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
    "products.view",
    "inventory.view", "inventory.transfer", "inventory.adjust",
    "vans.view",
    "loads.view", "loads.create", "loads.dispatch",
    "customers.view",
    "sales.view",
    "returns.view", "returns.approve",
    "reports.view",
  ],
  accountant: [
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
    "products.view",
    "inventory.view",
    "customers.view", "customers.create", "customers.edit",
    "sales.view", "sales.create",
    "credit.view",
    "payments.view",
    "reports.view",
  ],
  driver: [
    "products.view",
    "vans.view",
    "loads.view", "loads.confirm",
    "customers.view", "customers.create",
    "sales.view", "sales.create",
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
