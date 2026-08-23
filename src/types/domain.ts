/**
 * Domain vocabulary, mirroring the database enums defined in
 * supabase/migrations/0001_foundation.sql and 0010_enum_extensions.sql.
 *
 * These are the application's own types. Nothing here imports from
 * Supabase, so business logic never depends on the hosting provider.
 */

export const USER_ROLES = [
  "admin",
  "senior_manager",
  "manager",
  "sales_rep",
  // Field sales: crewed on a van, sells from it. Deliberately not the
  // same as sales_rep, which is office-based and has no van.
  "salesperson",
  "warehouse",
  "accountant",
  "driver",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ORDER_STATUSES = [
  "draft", "confirmed", "picking", "packed", "shipped", "delivered", "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const INVOICE_STATUSES = [
  "draft", "issued", "partially_paid", "paid", "overdue", "void",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const MOVEMENT_TYPES = [
  "receipt", "issue", "adjustment_in", "adjustment_out", "transfer_in",
  "transfer_out", "customer_return", "supplier_return", "damage", "shortage",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const VAN_LOAD_STATUSES = [
  "draft", "loaded", "dispatched", "returned", "reconciled", "cancelled",
] as const;
export type VanLoadStatus = (typeof VAN_LOAD_STATUSES)[number];

export const VAN_SALE_TYPES = ["cash", "credit"] as const;
export type VanSaleType = (typeof VAN_SALE_TYPES)[number];

export const RECONCILIATION_STATUSES = [
  "draft", "submitted", "approved", "rejected", "settled",
] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const PAYMENT_METHODS = [
  "cash", "bank_transfer", "cheque", "card", "mobile_money",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** The signed-in user as the application understands them. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  organizationId: string;
  isActive: boolean;
}
