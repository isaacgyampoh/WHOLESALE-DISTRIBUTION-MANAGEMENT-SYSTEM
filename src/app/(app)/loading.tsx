import { Skeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <div aria-busy="true">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="mt-2 mb-6 h-4 w-80" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
      <span className="sr-only">Loading dashboard</span>
    </div>
  );
}
