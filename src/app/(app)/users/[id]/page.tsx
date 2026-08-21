import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getStaffMember, getCategoryScopes, listAudit } from "@/features/staff/queries";
import { StaffDetail } from "@/features/staff/staff-detail";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS, AUDIT_LABELS } from "@/features/staff/shared";
import { formatDateTime, formatDate } from "@/lib/utils/format";
import { History } from "lucide-react";

export const metadata: Metadata = { title: "Staff member" };

export default async function StaffMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "users.manage")) return <Forbidden />;

  const { id } = await params;
  const result = await getStaffMember(id);

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Staff member" />
        <Card><ErrorState title="This page could not be loaded" message={result.message} /></Card>
      </>
    );
  }
  // Row level security already limits this to the caller's organization,
  // so someone else's id is indistinguishable from one that does not exist.
  if (!result.data) notFound();

  const member = result.data;
  const [categories, history] = await Promise.all([
    member.role === "manager" ? getCategoryScopes(member.id) : Promise.resolve(null),
    listAudit({ search: member.fullName }, 20),
  ]);

  return (
    <>
      <PageHeader
        title={member.fullName}
        description={ROLE_LABELS[member.role] ?? member.role}
        breadcrumbs={[
          { label: "Administration" },
          { label: "Staff", href: "/users" },
          { label: member.fullName },
        ]}
      />

      <Card className="mb-5">
        <CardBody className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Status" value={
            member.isActive
              ? <Badge tone="positive">Active</Badge>
              : <Badge tone="critical">Inactive</Badge>
          } />
          <Detail label="PIN" value={
            member.hasPin
              ? <Badge tone="positive">Set {formatDate(member.pinSetAt)}</Badge>
              : <Badge tone="caution">Not set</Badge>
          } />
          <Detail label="Phone" value={
            <span className="numeric">{member.phone ?? "Not recorded"}</span>
          } />
          <Detail label="Created" value={
            <span className="numeric">{formatDate(member.createdAt)}</span>
          } />
        </CardBody>
      </Card>

      <StaffDetail
        member={member}
        categories={categories?.ok ? categories.data : null}
        canManageRoles={can(user.role, "roles.manage")}
        isSelf={member.id === user.id}
      />

      <div className="mt-5">
        <Card>
          <CardHeader title="History" description="Administrative changes affecting this person." />
          {!history.ok ? (
            <ErrorState title="History unavailable" message={history.message} />
          ) : history.data.length === 0 ? (
            <EmptyState
              icon={History}
              title="Nothing recorded yet"
              description="Changes made from here will appear in this list."
            />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {history.data.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 text-sm">
                  <span className="numeric shrink-0 text-xs text-[var(--text-muted)]">
                    {formatDateTime(entry.occurredAt)}
                  </span>
                  <span className="font-medium text-[var(--text-primary)]">
                    {AUDIT_LABELS[entry.action] ?? entry.action}
                  </span>
                  <span className="text-[var(--text-secondary)]">by {entry.actorName}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs tracking-wide text-[var(--text-muted)] uppercase">{label}</p>
      <div className="mt-1.5">{value}</div>
    </div>
  );
}
