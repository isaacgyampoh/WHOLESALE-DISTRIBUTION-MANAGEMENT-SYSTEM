"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useTransition } from "react";
import { Input, Select } from "@/components/ui/field";
import { USER_ROLES } from "@/types/domain";
import { ROLE_LABELS } from "./shared";
import { Search } from "lucide-react";

/**
 * Search and filters, held in the URL.
 *
 * The query string is the state, so a filtered view can be shared or
 * reloaded and the server does the narrowing. Typing is debounced so a
 * search is one request, not one per keystroke.
 */
export function StaffFilters({ total }: { total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get("search") ?? "");

  const apply = (next: URLSearchParams) => {
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    const current = params.get("search") ?? "";
    if (search === current) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (search) next.set("search", search);
      else next.delete("search");
      apply(next);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    apply(next);
  };

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone"
          aria-label="Search staff"
          className="pl-9"
        />
      </div>

      <Select
        aria-label="Filter by role"
        value={params.get("role") ?? "all"}
        onChange={(e) => setParam("role", e.target.value)}
        className="sm:w-52"
      >
        <option value="all">All roles</option>
        {USER_ROLES.map((role) => (
          <option key={role} value={role}>{ROLE_LABELS[role]}</option>
        ))}
      </Select>

      <Select
        aria-label="Filter by status"
        value={params.get("status") ?? "all"}
        onChange={(e) => setParam("status", e.target.value)}
        className="sm:w-40"
      >
        <option value="all">All statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </Select>

      <p className="numeric shrink-0 text-sm text-[var(--text-muted)] sm:ml-1">
        {total} {total === 1 ? "person" : "people"}
      </p>
    </div>
  );
}
