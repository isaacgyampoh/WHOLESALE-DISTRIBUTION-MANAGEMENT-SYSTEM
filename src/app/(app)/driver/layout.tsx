import { requireUser } from "@/lib/auth/session";
import { Forbidden } from "@/components/layout/forbidden";
import { can } from "@/types/permissions";
import { SyncProvider } from "@/features/driver/sync-provider";
import { SyncBar } from "@/features/driver/sync-bar";

/**
 * The driver's part of the application.
 *
 * Everything under here is wrapped in the sync provider, so the queue
 * and the cached snapshot are read once and shared. The sync bar sits
 * above every screen because a driver's first question, on any of them,
 * is whether the office has seen their work.
 */
export default async function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  // Sales reps and supervisors reach these screens too - anyone who can
  // record a sale can use the offline path for it.
  if (!can(user.role, "sales.create") && !can(user.role, "loads.confirm")) {
    return <Forbidden />;
  }

  return (
    <SyncProvider>
      {/* Pulled out to the edges of <main>, whose padding is px-4 py-6
          (sm:px-6, lg:px-8). The bar spans the full width and sits hard
          against the header; the content below gets its padding back. */}
      <div className="-mx-4 -mt-6 sm:-mx-6 lg:-mx-8">
        <SyncBar />
        <div className="px-4 pt-6 sm:px-6 lg:px-8">{children}</div>
      </div>
    </SyncProvider>
  );
}
