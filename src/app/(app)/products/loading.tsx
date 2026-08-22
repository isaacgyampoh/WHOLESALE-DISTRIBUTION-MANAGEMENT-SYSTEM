import { Skeleton, TableSkeleton } from "@/components/ui/states";
import { Card } from "@/components/ui/card";

export default function Loading() {
  return (
    <div aria-busy="true">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="mt-2 mb-6 h-4 w-80" />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row">
        <Skeleton className="h-11 flex-1" />
        <Skeleton className="h-11 lg:w-52" />
        <Skeleton className="h-11 lg:w-44" />
        <Skeleton className="h-11 lg:w-36" />
      </div>
      <Card className="overflow-hidden"><TableSkeleton rows={8} cols={7} /></Card>
      <span className="sr-only">Loading products</span>
    </div>
  );
}
