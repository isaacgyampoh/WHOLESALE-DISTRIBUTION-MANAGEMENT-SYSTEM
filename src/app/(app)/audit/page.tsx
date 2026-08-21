import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listAudit } from "@/features/staff/queries";
import { AuditFilters } from "@/features/staff/audit-filters";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Alert } from "@/components/ui/states";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AUDIT_LABELS, ROLE_LABELS } from "@/features/staff/shared";
import { formatDateTime } from "@/lib/utils/format";
import type { UserRole } from "@/types/domain";
import { History } from "lucide-react";

export const metadata: Metadata = { title: "Audit trail" };

const PERIODS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30 };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; action?: string; period?: string }>;
}) {
  const user = await requireUser();
  // Reading history is an administrative act; row level security says
  // the same thing independently.
  if (!can(user.role, "users.manage")) return <Forbidden />;

  const { search, action, period } = await searchParams;
  const result = await listAudit({
    search,
    action,
    periodDays: period ? PERIODS[period] : undefined,
  });

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Who changed what, and when."
        breadcrumbs={[{ label: "Administration" }, { label: "Audit trail" }]}
      />

      <div className="mb-5">
        <Alert tone="info" title="History cannot be edited">
          Entries are written once and never altered, including by an
          administrator. No PIN or other secret is ever recorded.
        </Alert>
      </div>

      {!result.ok ? (
        <Card><ErrorState title="The audit trail is unavailable" message={result.message} /></Card>
      ) : (
        <>
          <AuditFilters total={result.data.length} />

          {result.data.length === 0 ? (
            <Card>
              <EmptyState
                icon={History}
                title="Nothing recorded yet"
                description="Administrative changes will appear here as they happen."
              />
            </Card>
          ) : (
            <>
              <TableWrap className="hidden pointer-fine:block">
                <Table>
                  <thead>
                    <tr>
                      <Th>When</Th>
                      <Th>Who</Th>
                      <Th>Action</Th>
                      <Th>Affecting</Th>
                      <Th>Change</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.map((entry) => (
                      <Tr key={entry.id}>
                        <Td className="numeric whitespace-nowrap text-[var(--text-secondary)]">
                          {formatDateTime(entry.occurredAt)}
                        </Td>
                        <Td>
                          <span className="block font-medium">{entry.actorName}</span>
                          {entry.actorRole && (
                            <span className="text-xs text-[var(--text-muted)]">
                              {ROLE_LABELS[entry.actorRole as UserRole] ?? entry.actorRole}
                            </span>
                          )}
                        </Td>
                        <Td><Badge tone="neutral">{AUDIT_LABELS[entry.action] ?? entry.action}</Badge></Td>
                        <Td>{entry.targetLabel ?? "-"}</Td>
                        <Td className="text-[var(--text-secondary)]"><Change entry={entry} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>

              <ul className="space-y-2 pointer-fine:hidden">
                {result.data.map((entry) => (
                  <li
                    key={entry.id}
                    className="surface rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <Badge tone="neutral">{AUDIT_LABELS[entry.action] ?? entry.action}</Badge>
                      <span className="numeric shrink-0 text-xs text-[var(--text-muted)]">
                        {formatDateTime(entry.occurredAt)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--text-primary)]">
                      {entry.targetLabel ?? "-"}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                      by {entry.actorName}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]"><Change entry={entry} /></p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}

/** A short, readable summary. Secrets never reach the log to begin with. */
function Change({ entry }: { entry: { before: Record<string, unknown> | null; after: Record<string, unknown> | null } }) {
  const { before, after } = entry;
  if (!before && !after) return <>-</>;

  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const parts: string[] = [];
  for (const key of keys) {
    const from = before?.[key];
    const to = after?.[key];
    if (from === undefined) parts.push(`${key}: ${String(to)}`);
    else if (to === undefined) parts.push(`${key}: was ${String(from)}`);
    else if (from !== to) parts.push(`${key}: ${String(from)} to ${String(to)}`);
  }
  return <>{parts.length ? parts.join(", ") : "-"}</>;
}
