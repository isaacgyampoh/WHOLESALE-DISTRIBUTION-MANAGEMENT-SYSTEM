import type { Permission } from "@/types/permissions";
import type { UserRole } from "@/types/domain";
import { canAny } from "@/types/permissions";

export interface NavItem {
  label: string;
  href: string;
  /** Shown when the user holds any one of these. */
  permissions: readonly Permission[];
  icon: string;
}

export interface NavSection {
  label: string;
  items: readonly NavItem[];
}

/**
 * Navigation is grouped by how the business actually works - the goods
 * move warehouse to van to customer, and the money comes back - rather
 * than by database table.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", href: "/", permissions: ["reports.view"], icon: "LayoutDashboard" }],
  },
  {
    label: "Catalogue",
    items: [
      { label: "Products", href: "/products", permissions: ["products.view"], icon: "Package" },
      { label: "Categories", href: "/categories", permissions: ["products.view"], icon: "Tags" },
    ],
  },
  {
    label: "Warehouse",
    items: [
      { label: "Warehouses", href: "/warehouses", permissions: ["inventory.view"], icon: "Warehouse" },
      { label: "Stock", href: "/inventory", permissions: ["inventory.view"], icon: "Boxes" },
      { label: "Movements", href: "/movements", permissions: ["inventory.view"], icon: "ArrowLeftRight" },
      { label: "Purchasing", href: "/purchasing", permissions: ["inventory.transfer"], icon: "Truck" },
    ],
  },
  {
    label: "Distribution",
    items: [
      { label: "Vans", href: "/vans", permissions: ["vans.view"], icon: "Van" },
      { label: "Van loads", href: "/loads", permissions: ["loads.view"], icon: "ClipboardList" },
      { label: "Returns", href: "/returns", permissions: ["returns.view"], icon: "Undo2" },
      { label: "Reconciliation", href: "/reconciliation", permissions: ["reconciliation.view"], icon: "Scale" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { label: "Customers", href: "/customers", permissions: ["customers.view"], icon: "Store" },
      { label: "Sales", href: "/sales", permissions: ["sales.view"], icon: "Receipt" },
      { label: "Credit", href: "/credit", permissions: ["credit.view"], icon: "CreditCard" },
      { label: "Payments", href: "/payments", permissions: ["payments.view"], icon: "Banknote" },
    ],
  },
  {
    label: "Insight",
    items: [
      { label: "Reports", href: "/reports", permissions: ["reports.view"], icon: "BarChart3" },
      { label: "Users", href: "/users", permissions: ["users.manage"], icon: "Users" },
    ],
  },
];

/** Sections with nothing visible to this role are dropped entirely. */
export function navigationFor(role: UserRole): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAny(role, item.permissions)),
  })).filter((section) => section.items.length > 0);
}
