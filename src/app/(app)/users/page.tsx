import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listStaff } from "@/features/staff/queries";
import { StaffList } from "@/features/staff/staff-list";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Alert } from "@/components/ui/states";
import { Users } from "lucide-react";

export const metadata: Metadata = { title: "Staff" };

export default async function UsersPage() {
  const user = await requireUser();

  // The page refuses first; row level security refuses again underneath.
  if (!can(user.role, "users.manage")) return <Forbidden />;

  const result = await listStaff();

  return (
    <>
      <PageHeader
        title="Staff"
        description="Who can sign in, and the PIN each of them uses."
        breadcrumbs={[{ label: "Administration" }, { label: "Staff" }]}
      />

      <div className="mb-5">
        <Alert tone="info" title="PINs are shown once">
          A PIN is stored as a one-way digest and cannot be read back. If someone
          forgets theirs, set a new one here.
        </Alert>
      </div>

      {!result.ok ? (
        <Card>
          <ErrorState title="The staff list is unavailable" message={result.message} />
        </Card>
      ) : result.staff.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No staff yet"
            description="Accounts are created in Supabase Authentication, then given a PIN here."
          />
        </Card>
      ) : (
        <StaffList staff={result.staff} />
      )}
    </>
  );
}
