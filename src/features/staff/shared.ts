import type { UserRole } from "@/types/domain";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  senior_manager: "Senior manager",
  manager: "Manager",
  warehouse: "Warehouse",
  accountant: "Accountant",
  // Office-based sales. Kept distinct from salesperson, who is crewed
  // on a van and sells from it in the field.
  sales_rep: "Sales representative (office)",
  salesperson: "Salesperson (field)",
  driver: "Driver",
};

export const CREW_ROLE_LABELS: Record<string, string> = {
  driver: "Driver",
  salesperson: "Salesperson",
};

export const AUDIT_LABELS: Record<string, string> = {
  "user.created": "Created staff",
  "user.updated": "Updated staff",
  "user.activated": "Activated",
  "user.deactivated": "Deactivated",
  "user.role_changed": "Changed role",
  "user.pin_reset": "Reset PIN",
  "user.pin_changed": "Changed own PIN",
  "user.categories_changed": "Changed category access",
};
