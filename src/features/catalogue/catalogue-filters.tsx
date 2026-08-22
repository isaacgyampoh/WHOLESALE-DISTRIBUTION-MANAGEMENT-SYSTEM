"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useTransition } from "react";
import { Input, Select } from "@/components/ui/field";
import { Search } from "lucide-react";
import type { CategoryRow } from "./queries";

/** Filters held in the URL and applied by the database. */
export function CatalogueFilters({
  categories,
  total,
  showStock = true,
}: {
  categories: CategoryRow[];
  total: number;
  showStock?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get("search") ?? "");

  const apply = (next: URLSearchParams) => {
    // A changed filter always returns to the first page.
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    const current = params.get("search") ?? "";
    if (search === current) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (search) next.set("search", search); else next.delete("search");
      apply(next);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "all") next.set(key, value); else next.delete(key);
    apply(next);
  };

  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or product code"
          aria-label="Search products"
          className="pl-9"
        />
      </div>

      <Select
        aria-label="Filter by category"
        value={params.get("category") ?? "all"}
        onChange={(e) => setParam("category", e.target.value)}
        className="lg:w-52"
      >
        <option value="all">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </Select>

      {showStock && (
        <Select
          aria-label="Filter by stock"
          value={params.get("stock") ?? "all"}
          onChange={(e) => setParam("stock", e.target.value)}
          className="lg:w-44"
        >
          <option value="all">Any stock level</option>
          <option value="in_stock">In stock</option>
          <option value="low_stock">Low stock</option>
          <option value="out_of_stock">Out of stock</option>
        </Select>
      )}

      <Select
        aria-label="Filter by status"
        value={params.get("status") ?? "all"}
        onChange={(e) => setParam("status", e.target.value)}
        className="lg:w-36"
      >
        <option value="all">All statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </Select>

      <p className="numeric shrink-0 text-sm text-[var(--text-muted)] lg:ml-1">
        {total} {total === 1 ? "product" : "products"}
      </p>
    </div>
  );
}
