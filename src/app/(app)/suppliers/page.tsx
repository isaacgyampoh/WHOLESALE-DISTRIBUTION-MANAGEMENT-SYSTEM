import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listSuppliers } from "@/features/warehouses/queries";
import { listPortalStatus } from "@/features/suppliers/queries";
import { IssuePortalLinkButton } from "@/features/suppliers/supplier-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { formatDate } from "@/lib/utils/format";
import { Building2, Link2, Inbox } from "lucide-react";

export const metadata: Metadata = { title: "Suppliers" };

/**
 * The suppliers, and the state of each one's portal link.
 *
 * This page exists because the portal was unreachable without it. The
 * link button lived only on a supplier's own page, and the only way to
 * that page was to notice a supplier's name inside the purchasing
 * screen and click it - so the feature was built, deployed, working,
 * and invisible.
 *
 * The link is the point of the page, so it is a column and an action on
 * every row rather than something to go looking for.
 */
export default async function SuppliersPage() {
  const user = await requireUser();
  if (!can(user.role, "inventory.transfer")) return <Forbidden />;

  const [suppliers, portal] = await Promise.all([listSuppliers(), listPortalStatus()]);
  const mayIssue = can(user.role, "users.manage");
  const status = portal.ok ? portal.data : new Map();

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Who you buy from, and the secure link each one uses to send invoices."
        breadcrumbs={[
          { label: "Warehouse" },
          { label: "Purchasing", href: "/purchasing" },
          { label: "Suppliers" },
        ]}
      />

      {!suppliers.ok ? (
        <ErrorState message={suppliers.message} />
      ) : suppliers.data.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No suppliers yet"
          description="Add a supplier from Purchasing. Once one exists you can issue them a link for sending invoices."
          action={<Link href="/purchasing" className="text-brand-700 hover:underline dark:text-brand-300">Go to Purchasing</Link>}
        />
      ) : (
        <Card className="mt-6 p-0">
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Supplier</Th>
                  <Th>Contact</Th>
                  <Th>Invoice portal</Th>
                  <Th>Awaiting review</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {suppliers.data.map((s) => {
                  const state = status.get(s.id);
                  const links = state?.activeLinks ?? 0;
                  const waiting = state?.documentsAwaiting ?? 0;
                  return (
                    <Tr key={s.id}>
                      <Td>
                        <Link
                          href={`/suppliers/${s.id}`}
                          className="block font-medium text-[var(--text-primary)] hover:text-brand-700 hover:underline dark:hover:text-brand-300"
                        >
                          {s.name}
                        </Link>
                        <span className="numeric text-xs text-[var(--text-muted)]">{s.code}</span>
                        {!s.isActive && (
                          <Badge tone="neutral" className="ml-2">Inactive</Badge>
                        )}
                      </Td>

                      <Td className="text-[var(--text-secondary)]">
                        {s.contactName ?? "-"}
                        {s.phone && <span className="numeric block text-xs">{s.phone}</span>}
                      </Td>

                      <Td>
                        {links > 0 ? (
                          <>
                            <Badge tone="positive">
                              <Link2 className="size-3" aria-hidden />
                              {links === 1 ? "Link active" : `${links} links active`}
                            </Badge>
                            {state?.nextExpiry && (
                              <span className="block text-xs text-[var(--text-muted)]">
                                until {formatDate(state.nextExpiry)}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-sm text-[var(--text-muted)]">
                            No link issued
                          </span>
                        )}
                      </Td>

                      <Td>
                        {waiting > 0 ? (
                          <Link href="/suppliers/review" className="inline-flex">
                            <Badge tone="caution">
                              <Inbox className="size-3" aria-hidden />
                              {waiting}
                            </Badge>
                          </Link>
                        ) : (
                          <span className="text-sm text-[var(--text-muted)]">-</span>
                        )}
                      </Td>

                      <Td className="text-right">
                        {mayIssue && s.isActive && (
                          <IssuePortalLinkButton
                            supplierId={s.id}
                            supplierName={s.name}
                            size="sm"
                            label={links > 0 ? "New link" : "Issue link"}
                          />
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}
    </>
  );
}
