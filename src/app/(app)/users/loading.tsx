import { Skeleton, TableSkeleton } from "@/components/ui/states";
import { Card } from "@/components/ui/card";

export default function Loading() {
  return (
    <div aria-busy="true">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-2 mb-6 h-4 w-96" />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Skeleton className="h-11 flex-1" />
        <Skeleton className="h-11 sm:w-52" />
        <Skeleton className="h-11 sm:w-40" />
      </div>
      <Card className="overflow-hidden">
        <TableSkeleton rows={6} cols={6} />
      </Card>
      <span className="sr-only">Loading staff</span>
    </div>
  );
}
