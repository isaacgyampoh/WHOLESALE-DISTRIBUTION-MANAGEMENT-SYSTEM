"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useTransition } from "react";
import { Input, Select } from "@/components/ui/field";
import { MOVEMENT_LABELS } from "@/lib/catalogue/units";
import { Search } from "lucide-react";

export function MovementFilters({ total }: { total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get("search") ?? "");

  const apply = (next: URLSearchParams) =>
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));

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
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by product"
          aria-label="Search stock movements"
          className="pl-9"
        />
      </div>

      <Select
        aria-label="Filter by movement type"
        value={params.get("type") ?? "all"}
        onChange={(e) => setParam("type", e.target.value)}
        className="sm:w-56"
      >
        <option value="all">All movements</option>
        {Object.entries(MOVEMENT_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </Select>

      <Select
        aria-label="Filter by period"
        value={params.get("period") ?? "all"}
        onChange={(e) => setParam("period", e.target.value)}
        className="sm:w-40"
      >
        <option value="all">Any time</option>
        <option value="24h">Last 24 hours</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
      </Select>

      <p className="numeric shrink-0 text-sm text-[var(--text-muted)] sm:ml-1">
        {total} {total === 1 ? "movement" : "movements"}
      </p>
    </div>
  );
}
