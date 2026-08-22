import type { Permission } from "@/types/permissions";
import type { UserRole } from "@/types/domain";
import { can, canAny } from "@/types/permissions";

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
      // The offline-capable round. Anyone who can record a sale can use
      // it; for a driver it is the whole application.
      {
        label: "My round", href: "/driver", permissions: ["sales.create"],
        icon: "Truck", mobilePriority: 1,
      },
    ],
  },
  {
    label: "Catalogue",
    items: [
      {
        label: "Products", href: "/products", permissions: ["products.view"],
        icon: "Package", mobilePriority: 5,
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
        icon: "Boxes", mobilePriority: 4,
      },
      {
        label: "Movements", href: "/inventory/movements",
        permissions: ["inventory.view"], icon: "ArrowLeftRight",
      },
      { label: "Expiry", href: "/inventory/expiry", permissions: ["inventory.view"], icon: "CalendarClock" },
      { label: "Transfers", href: "/transfers", permissions: ["inventory.transfer"], icon: "ArrowLeftRight" },
      { label: "Purchasing", href: "/purchasing", permissions: ["inventory.transfer"], icon: "Truck" },
    ],
  },
  {
    label: "Distribution",
    items: [
      { label: "Vans", href: "/vans", permissions: ["vans.view"], icon: "Van" },
      {
        label: "Van loads", href: "/loads", permissions: ["loads.view"],
        icon: "ClipboardList", mobilePriority: 6,
      },
      { label: "Waybills", href: "/waybills", permissions: ["documents.view"], icon: "FileOutput" },
      { label: "Returns", href: "/returns", permissions: ["returns.view"], icon: "Undo2" },
      { label: "Reconciliation", href: "/reconciliation", permissions: ["reconciliation.view"], icon: "Scale" },
    ],
  },
  {
    label: "Commercial",
    items: [
      {
        label: "Customers", href: "/customers", permissions: ["customers.view"],
        icon: "Store", mobilePriority: 3,
      },
      {
        label: "Sales", href: "/sales", permissions: ["sales.view"],
        icon: "Receipt", mobilePriority: 2,
      },
      { label: "Invoices", href: "/invoices", permissions: ["documents.view"], icon: "FileText" },
      { label: "Credit", href: "/credit", permissions: ["credit.view"], icon: "CreditCard" },
      {
        label: "Collections", href: "/payments", permissions: ["payments.view"],
        icon: "Banknote", mobilePriority: 7,
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
      { label: "Settings", href: "/settings", permissions: ["users.manage"], icon: "Settings" },
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

/**
 * The round, for the people who run one.
 *
 * A driver's day is not a smaller version of the office's. They sell
 * from a van, take money, bring goods back and close the day - and
 * every one of those is a screen built for standing outside a shop.
 * Handing them Products, Purchasing, Warehouses and Audit alongside it
 * buries the four things they actually do.
 *
 * This is presentation only. Every route is authorised on the server
 * and by row level security; a driver who types /purchasing is refused
 * there, not here.
 */
const DRIVER_SECTIONS: readonly NavSection[] = [
  {
    label: "My round",
    items: [
      {
        label: "Home", href: "/driver", permissions: ["sales.create"],
        icon: "LayoutDashboard", mobilePriority: 0,
      },
      {
        label: "Sell", href: "/driver/sell", permissions: ["sales.create"],
        icon: "Receipt", mobilePriority: 1,
      },
      {
        label: "Van stock", href: "/driver/stock", permissions: ["sales.create"],
        icon: "Boxes", mobilePriority: 2,
      },
      {
        label: "Collect", href: "/driver/collect", permissions: ["payments.create"],
        icon: "Banknote", mobilePriority: 3,
      },
    ],
  },
  {
    label: "End of round",
    items: [
      { label: "Return goods", href: "/driver/return", permissions: ["returns.submit"], icon: "Undo2" },
      { label: "End my day", href: "/driver/reconcile", permissions: ["reconciliation.submit"], icon: "Scale" },
    ],
  },
  {
    label: "My records",
    items: [
      { label: "My sales", href: "/driver/sales", permissions: ["sales.view"], icon: "Receipt" },
      { label: "What I have recorded", href: "/driver/queue", permissions: ["sales.create"], icon: "ClipboardList" },
    ],
  },
];

/**
 * Whether this role runs a round rather than the office.
 *
 * Keyed on the permission set rather than the role name, so a role that
 * is given the driver's capabilities later gets the driver's navigation
 * without anyone remembering to update a list. A supervisor covering a
 * van still gets the full menu, because they can also do everything
 * else.
 */
function runsARound(role: UserRole): boolean {
  return can(role, "sales.create")
    && can(role, "loads.confirm")
    && !can(role, "products.edit")
    && !can(role, "users.manage");
}

/** Sections with nothing visible to this role are dropped entirely. */
export function navigationFor(role: UserRole): NavSection[] {
  const sections = runsARound(role) ? DRIVER_SECTIONS : NAV_SECTIONS;
  return sections.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAny(role, item.permissions)),
  })).filter((section) => section.items.length > 0);
}
