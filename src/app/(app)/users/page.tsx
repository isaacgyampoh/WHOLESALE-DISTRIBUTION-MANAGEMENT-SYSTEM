import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listStaff } from "@/features/staff/queries";
import { StaffList, CreateStaffButton } from "@/features/staff/staff-list";
import { StaffFilters } from "@/features/staff/staff-filters";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Users, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Staff" };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; role?: string; status?: string }>;
}) {
  const user = await requireUser();

  // Refused here, and refused again by row level security underneath.
  if (!can(user.role, "users.manage")) return <Forbidden />;

  const filters = await searchParams;
  const result = await listStaff(filters);
  const filtered = Boolean(filters.search || (filters.role && filters.role !== "all") ||
    (filters.status && filters.status !== "all"));

  return (
    <>
      <PageHeader
        title="Staff"
        description="Who can sign in, what they may do, and the PIN each of them uses."
        breadcrumbs={[{ label: "Administration" }, { label: "Staff" }]}
        actions={<CreateStaffButton canManageRoles={can(user.role, "roles.manage")} />}
      />

      {!result.ok ? (
        <Card>
          <ErrorState title="The staff list is unavailable" message={result.message} />
        </Card>
      ) : (
        <>
          <StaffFilters total={result.data.length} />

          {result.data.length === 0 ? (
            <Card>
              {filtered ? (
                <EmptyState
                  icon={SearchX}
                  title="Nobody matches those filters"
                  description="Try a different search, role or status."
                />
              ) : (
                <EmptyState
                  icon={Users}
                  title="No staff members yet"
                  description="Create the first account and give it a PIN."
                />
              )}
            </Card>
          ) : (
            <StaffList staff={result.data} />
          )}
        </>
      )}
    </>
  );
}
