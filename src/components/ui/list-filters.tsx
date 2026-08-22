"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useTransition } from "react";
import { Input, Select } from "@/components/ui/field";
import { Search } from "lucide-react";

export interface FilterSelect {
  /** Query-string key this control owns. */
  name: string;
  label: string;
  /** The "no filter" entry. Its value is always `all`. */
  allLabel: string;
  options: readonly { value: string; label: string }[];
  className?: string;
}

/**
 * Filters held in the URL rather than in component state.
 *
 * The server reads them from `searchParams` and narrows the query, so a
 * filtered view is a real address: it can be linked, bookmarked, and it
 * survives a reload. Declaring the controls as data keeps every list
 * screen filtering the same way instead of each inventing its own bar.
 */
export function ListFilters({
  searchPlaceholder,
  searchLabel,
  selects = [],
  count,
  noun,
}: {
  searchPlaceholder?: string;
  searchLabel?: string;
  selects?: readonly FilterSelect[];
  count: number;
  /** Singular form; pluralised by adding "s". */
  noun: string;
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

  // Typing should not put a request on every keystroke, and it should
  // not fire at all when the box already agrees with the URL - which is
  // what happens on the render right after a filter is applied.
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
      {searchPlaceholder && (
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchLabel ?? searchPlaceholder}
            className="pl-9"
          />
        </div>
      )}

      {selects.map((s) => (
        <Select
          key={s.name}
          aria-label={s.label}
          value={params.get(s.name) ?? "all"}
          onChange={(e) => setParam(s.name, e.target.value)}
          className={s.className ?? "lg:w-44"}
        >
          <option value="all">{s.allLabel}</option>
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      ))}

      <p className="numeric shrink-0 text-sm text-[var(--text-muted)] lg:ml-1">
        {count} {count === 1 ? noun : `${noun}s`}
      </p>
    </div>
  );
}
