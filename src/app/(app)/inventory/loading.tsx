import { Skeleton, TableSkeleton } from "@/components/ui/states";
import { Card } from "@/components/ui/card";

export default function Loading() {
  return (
    <div aria-busy="true">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-2 mb-6 h-4 w-96" />
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Card className="overflow-hidden"><TableSkeleton rows={6} cols={7} /></Card>
      <span className="sr-only">Loading inventory</span>
    </div>
  );
}
