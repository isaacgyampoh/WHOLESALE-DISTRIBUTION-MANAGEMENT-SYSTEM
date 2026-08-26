import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can, PERMISSIONS, permissionsFor } from "@/types/permissions";
import { USER_ROLES } from "@/types/domain";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/states";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { ROLE_LABELS } from "@/features/staff/shared";
import { Check, Minus } from "lucide-react";

export const metadata: Metadata = { title: "Permissions" };

/** Human wording for each capability, grouped the way the app is used. */
const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  { title: "Staff", items: [
    ["users.manage", "Manage staff accounts"],
    ["roles.manage", "Assign roles and category access"],
  ]},
  { title: "Catalogue", items: [
    ["products.view", "View products"],
    ["products.create", "Create products"],
    ["products.edit", "Edit products"],
  ]},
  { title: "Stock", items: [
    ["inventory.view", "View stock"],
    ["inventory.transfer", "Move stock"],
    ["inventory.adjust", "Add and correct stock"],
    ["inventory.count", "Run a stock count"],
  ]},
  { title: "Distribution", items: [
    ["vans.view", "View vans"],
    ["vans.manage", "Manage vans and assign crew"],
    ["vans.crew", "Be crew on a van"],
    ["loads.view", "View van loads"],
    ["loads.create", "Create van loads"],
    ["loads.dispatch", "Dispatch a van"],
    ["loads.confirm", "Confirm a load as driver"],
    ["returns.view", "View returns"],
    ["returns.submit", "Submit a return"],
    ["returns.approve", "Approve a return"],
    ["reconciliation.view", "View reconciliation"],
    ["reconciliation.submit", "Submit reconciliation"],
    ["reconciliation.approve", "Approve reconciliation"],
  ]},
  { title: "Commercial", items: [
    ["customers.view", "View customers"],
    ["customers.create", "Create customers"],
    ["customers.edit", "Edit customers"],
    ["sales.view", "View sales"],
    ["sales.create", "Sell to a customer"],
    ["credit.view", "View credit"],
    ["credit.approve", "Approve credit"],
    ["credit.override", "Override a credit limit"],
    ["payments.view", "View payments"],
    ["payments.create", "Record payments"],
  ]},
  { title: "Insight", items: [
    ["dashboard.view", "See the dashboard"],
    ["reports.view", "View reports"],
  ]},
];

export default async function PermissionsPage() {
  const user = await requireUser();
  if (!can(user.role, "users.manage")) return <Forbidden />;

  const held = new Map(USER_ROLES.map((role) => [role, new Set(permissionsFor(role))]));
  const known = new Set<string>(PERMISSIONS);

  return (
    <>
      <PageHeader
        title="Permissions"
        description="What each role may do. Enforced on the server and in the database, not by hiding buttons."
        breadcrumbs={[{ label: "Administration" }, { label: "Permissions" }]}
      />

      <div className="mb-5">
        <Alert tone="info" title="Permissions follow the role">
          Capabilities are not granted to people individually. Change what
          someone may do by changing their role on their staff page.
        </Alert>
      </div>

      <div className="space-y-5">
        {GROUPS.map((group) => (
          <Card key={group.title}>
            <TableWrap className="rounded-none border-0">
              <Table>
                <thead>
                  <tr>
                    <Th className="min-w-56">{group.title}</Th>
                    {USER_ROLES.map((role) => (
                      <Th key={role} numeric className="whitespace-nowrap">
                        {ROLE_LABELS[role]}
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.items
                    .filter(([capability]) => known.has(capability))
                    .map(([capability, label]) => (
                      <Tr key={capability}>
                        <Td>
                          <span className="block">{label}</span>
                          <code className="text-xs text-[var(--text-muted)]">{capability}</code>
                        </Td>
                        {USER_ROLES.map((role) => (
                          <Td key={role} numeric>
                            {held.get(role)?.has(capability as never) ? (
                              <Check className="ml-auto size-4 text-positive" aria-label="Allowed" />
                            ) : (
                              <Minus className="ml-auto size-4 text-[var(--text-muted)]" aria-label="Not allowed" />
                            )}
                          </Td>
                        ))}
                      </Tr>
                    ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        ))}
      </div>
    </>
  );
}
