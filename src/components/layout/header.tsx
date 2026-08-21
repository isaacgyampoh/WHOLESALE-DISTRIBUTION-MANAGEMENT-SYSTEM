import type { AuthenticatedUser } from "@/types/domain";
import { Badge } from "@/components/ui/badge";
import { BRAND } from "@/lib/brand";
import { LogOut } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  senior_manager: "Senior manager",
  manager: "Category manager",
  warehouse: "Warehouse",
  accountant: "Accountant",
  sales_rep: "Sales rep",
  driver: "Driver",
};

/**
 * The role is shown deliberately: what a user can see here is scoped by
 * it, so when a category manager cannot find a product, the reason is on
 * screen rather than a mystery.
 */
export function Header({ user }: { user: AuthenticatedUser }) {
  const initials = user.fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-primary)] lg:hidden">
        {BRAND.name}
      </span>
      <div className="hidden flex-1 lg:block" />
      {/* Below 400px the name and the role badge cannot both fit; the
          name wins, and the role stays visible from small tablets up. */}
      <Badge tone="brand" className="hidden min-[400px]:inline-flex">
        {ROLE_LABELS[user.role] ?? user.role}
      </Badge>
      <div className="flex items-center gap-2.5 border-l border-[var(--border-subtle)] pl-3">
        <div className="grid size-8 place-items-center rounded-full bg-[var(--surface-sunken)] text-xs font-semibold text-[var(--text-secondary)]">
          {initials}
        </div>
        <div className="hidden min-w-0 leading-tight sm:block">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">{user.fullName}</p>
          <p className="truncate text-xs text-[var(--text-muted)]">{user.email}</p>
        </div>
        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            aria-label="Sign out"
            className="grid size-11 place-items-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] pointer-fine:size-9"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </header>
  );
}
