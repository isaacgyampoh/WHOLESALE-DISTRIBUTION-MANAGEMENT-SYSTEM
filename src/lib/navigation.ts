import type { Permission } from "@/types/permissions";
import type { UserRole } from "@/types/domain";
import { canAny } from "@/types/permissions";

export interface NavItem {
  label: string;
  href: string;
  /** Shown when the user holds any one of these. */
  permissions: readonly Permission[];
  icon: string;
  /**
   * Where this belongs on the phone's bottom bar, lower first. Only four
   * destinations fit, and taking the first four in declaration order gave
   * drivers "Products, Categories, Vans, Van loads" - none of which is a
   * task a driver performs. Items without a priority never reach the bar
   * and live under "More".
   */
  mobilePriority?: number;
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
    items: [
      {
        label: "Dashboard", href: "/", permissions: ["dashboard.view"],
        icon: "LayoutDashboard", mobilePriority: 0,
      },
    ],
  },
  {
    label: "Selling",
    items: [
      // First on the phone for anyone who sells: it is the only screen
      // a field salesperson opens all day.
      {
        label: "Sell", href: "/sell", permissions: ["sales.create"],
        icon: "ShoppingCart", mobilePriority: 1,
      },
      // The crew's own van. A manager does not have one, which is why
      // this is not gated on vans.view.
      {
        label: "My van", href: "/my-van", permissions: ["vans.crew"],
        icon: "Van", mobilePriority: 2,
      },
    ],
  },
  {
    label: "Catalogue",
    items: [
      {
        label: "Products", href: "/products", permissions: ["products.view"],
        icon: "Package", mobilePriority: 6,
      },
      // Category maintenance is a management screen, not something a
      // driver or a sales rep has any use for.
      { label: "Categories", href: "/categories", permissions: ["products.edit"], icon: "Tags" },
    ],
  },
  {
    label: "Warehouse",
    items: [
      { label: "Warehouses", href: "/warehouses", permissions: ["inventory.view"], icon: "Warehouse" },
      {
        label: "Stock", href: "/inventory", permissions: ["inventory.view"],
        icon: "Boxes", mobilePriority: 5,
      },
      { label: "Movements", href: "/movements", permissions: ["inventory.view"], icon: "ArrowLeftRight" },
      { label: "Purchasing", href: "/purchasing", permissions: ["inventory.transfer"], icon: "Truck" },
    ],
  },
  {
    label: "Distribution",
    items: [
      { label: "Vans", href: "/vans", permissions: ["vans.view"], icon: "Van" },
      {
        label: "Van loads", href: "/loads", permissions: ["loads.view"],
        icon: "ClipboardList", mobilePriority: 8,
      },
      { label: "Returns", href: "/returns", permissions: ["returns.view"], icon: "Undo2" },
      { label: "Reconciliation", href: "/reconciliation", permissions: ["reconciliation.view"], icon: "Scale" },
    ],
  },
  {
    label: "Commercial",
    items: [
      {
        label: "Customers", href: "/customers", permissions: ["customers.view"],
        icon: "Store", mobilePriority: 7,
      },
      {
        label: "Sales", href: "/sales", permissions: ["sales.view"],
        icon: "Receipt", mobilePriority: 3,
      },
      { label: "Credit", href: "/credit", permissions: ["credit.view"], icon: "CreditCard" },
      {
        label: "Payments", href: "/payments", permissions: ["payments.view"],
        icon: "Banknote", mobilePriority: 9,
      },
    ],
  },
  {
    label: "Insight",
    items: [
      { label: "Reports", href: "/reports", permissions: ["reports.view"], icon: "BarChart3" },
      { label: "Staff", href: "/users", permissions: ["users.manage"], icon: "Users" },
      { label: "Permissions", href: "/permissions", permissions: ["users.manage"], icon: "ShieldCheck" },
      { label: "Audit trail", href: "/audit", permissions: ["users.manage"], icon: "History" },
    ],
  },
];

/**
 * The four destinations that go on the phone's bottom bar, chosen by
 * declared priority among what this role can actually reach.
 */
export function primaryMobileItems(sections: NavSection[], count = 4): NavItem[] {
  return sections
    .flatMap((s) => s.items)
    .filter((i) => i.mobilePriority !== undefined)
    .sort((a, b) => (a.mobilePriority ?? 99) - (b.mobilePriority ?? 99))
    .slice(0, count);
}

/** Sections with nothing visible to this role are dropped entirely. */
export function navigationFor(role: UserRole): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAny(role, item.permissions)),
  })).filter((section) => section.items.length > 0);
}
