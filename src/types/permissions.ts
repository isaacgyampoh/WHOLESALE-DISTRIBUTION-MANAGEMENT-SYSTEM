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
  "inventory.view", "inventory.transfer", "inventory.adjust",
  // Approving a transfer is separate from raising one on purpose: a
  // depot that signs off its own moves stock wherever it likes.
  "transfers.approve",
  "vans.view", "vans.manage",
  // Crewing a van is a supervisory act: it decides who may sell from it
  // and who is accountable for the vehicle.
  "vans.crew",
  "loads.view", "loads.create", "loads.dispatch", "loads.confirm",
  "customers.view", "customers.create", "customers.edit",
  "sales.view", "sales.create",
  "credit.view", "credit.approve", "credit.override",
  "payments.view", "payments.create",
  // Invoices, receipts and waybills. Viewing is what most roles need;
  // issuing a waybill signs goods out of a warehouse.
  "documents.view", "documents.issue",
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
    "inventory.view", "inventory.transfer", "inventory.adjust",
    "transfers.approve",
    "vans.view", "vans.manage",
  // Crewing a van is a supervisory act: it decides who may sell from it
  // and who is accountable for the vehicle.
  "vans.crew",
    "loads.view", "loads.create", "loads.dispatch",
    "customers.view", "customers.create", "customers.edit",
    "sales.view", "sales.create",
    "credit.view", "credit.approve",
    "payments.view", "payments.create",
    "documents.view", "documents.issue",
    "returns.view", "returns.approve",
    "reconciliation.view", "reconciliation.approve",
    "reports.view",
  ],
  warehouse: [
    "dashboard.view",
    "products.view",
    "inventory.view", "inventory.transfer", "inventory.adjust",
    "vans.view", "vans.crew",
    "loads.view", "loads.create", "loads.dispatch",
    "customers.view",
    "sales.view",
    "documents.view", "documents.issue",
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
    "documents.view",
    "returns.view",
    "reconciliation.view",
    "reports.view",
  ],
  sales_rep: [
    "dashboard.view",
    "products.view",
    "inventory.view",
    "customers.view", "customers.create", "customers.edit",
    "sales.view", "sales.create",
    "credit.view",
    "payments.view",
    "documents.view",
    "reports.view",
  ],
  // The driver drives. They do not sell.
  //
  // This role deliberately holds neither sales.create nor
  // payments.create. It used to hold both, because the schema treated
  // the driver as the salesperson - which put the wrong name on every
  // receipt and handed the till to whoever was behind the wheel.
  driver: [
    "dashboard.view",
    "products.view",
    "vans.view",
    "loads.view", "loads.confirm",
    "customers.view",
    // Their own van's sales, so they can see what the round did. Not
    // the ability to make one.
    "sales.view",
    "documents.view",
    "returns.view", "returns.submit",
    "reconciliation.view", "reconciliation.submit",
  ],
  // The field salesperson. Sells from the van they are crewed on, takes
  // the money, and sees nothing about what any of it cost.
  salesperson: [
    "dashboard.view",
    "products.view",
    "vans.view",
    "loads.view",
    "customers.view", "customers.create",
    "sales.view", "sales.create",
    "credit.view",
    "payments.view", "payments.create",
    "documents.view",
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
