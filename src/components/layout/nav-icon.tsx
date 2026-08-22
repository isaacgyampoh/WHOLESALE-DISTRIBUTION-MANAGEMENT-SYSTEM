"use client";

import {
  LayoutDashboard, Package, Tags, Warehouse, Boxes, ArrowLeftRight, Truck,
  ClipboardList, Undo2, Scale, Store, Receipt, CreditCard, Banknote,
  BarChart3, Users, ShieldCheck, History, Settings, CalendarClock, Circle, type LucideIcon,
} from "lucide-react";

/**
 * Navigation is declared as data, so icons are resolved by name here
 * rather than importing components into the route table.
 */
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Package, Tags, Warehouse, Boxes, ArrowLeftRight, Truck,
  ClipboardList, Undo2, Scale, Store, Receipt, CreditCard, Banknote,
  BarChart3, Users, ShieldCheck, History, Settings, CalendarClock,
  // lucide has no dedicated van glyph; Truck reads correctly at this size.
  Van: Truck,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Circle;
  return <Icon className={className} aria-hidden />;
}
