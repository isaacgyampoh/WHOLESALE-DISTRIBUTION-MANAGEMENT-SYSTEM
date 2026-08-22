import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { listCustomers, getCreditSummary, PAGE_SIZE } from "@/features/commercial/queries";
import { CustomerList } from "@/features/commercial/customer-list";
import { CreateCustomerButton } from "@/features/commercial/customer-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { ListFilters } from "@/components/ui/list-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatMoney, formatQuantity } from "@/lib/utils/format";
import { Store, SearchX } from "lucide-react";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "customers.view")) return <Forbidden />;

  const filters = await searchParams;
  const [result, credit] = await Promise.all([
    listCustomers({
      search: filters.search,
      status: filters.status,
      credit: filters.credit,
      page: Number(filters.page ?? 1),
    }),
    getCreditSummary(),
  ]);

  const narrowed = Boolean(
    filters.search ||
    (filters.status && filters.status !== "all") ||
    (filters.credit && filters.credit !== "all"),
  );

  return (
    <>
      <PageHeader
        title="Customers"
        description="Who the business sells to, and what each of them owes."
        breadcrumbs={[{ label: "Commercial" }, { label: "Customers" }]}
        actions={can(user.role, "customers.create") ? <CreateCustomerButton /> : undefined}
      />

      {credit.ok && (
        <StatGrid>
          <StatTile label="Customers" value={formatQuantity(result.ok ? result.data.total : 0)}
                    sub="Matching this view" />
          <StatTile label="Outstanding" value={formatMoney(credit.data.outstanding)}
                    sub="Owed across the book"
                    tone={credit.data.outstanding > 0 ? "caution" : "neutral"} />
          <StatTile label="Owing now" value={formatQuantity(credit.data.customersOwing)}
                    sub="Customers with a balance" />
          <StatTile label="Over limit" value={formatQuantity(credit.data.overLimit)}
                    sub="Past their credit limit"
                    tone={credit.data.overLimit > 0 ? "critical" : "neutral"}
                    href="/customers?credit=over_limit" />
        </StatGrid>
      )}

      {!result.ok ? (
        <Card><ErrorState title="Customers could not be loaded" message={result.message} /></Card>
      ) : (
        <>
          <ListFilters
            searchPlaceholder="Search by name, code or phone"
            searchLabel="Search customers"
            selects={[
              {
                name: "credit", label: "Filter by credit", allLabel: "Any credit state",
                options: [
                  { value: "owing", label: "Owing" },
                  { value: "overdue", label: "Overdue" },
                  { value: "over_limit", label: "Over limit" },
                ],
                className: "lg:w-48",
              },
              {
                name: "status", label: "Filter by status", allLabel: "All statuses",
                options: [
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive" },
                ],
                className: "lg:w-36",
              },
            ]}
            count={result.data.total}
            noun="customer"
          />

          <Card className="overflow-hidden">
            {result.data.customers.length === 0 ? (
              narrowed ? (
                <EmptyState icon={SearchX} title="No customers match those filters"
                            description="Try a different search or credit state." />
              ) : (
                <EmptyState icon={Store} title="No customers yet"
                            description="A customer is who a sale is recorded against."
                            action={can(user.role, "customers.create") ? <CreateCustomerButton /> : undefined} />
              )
            ) : (
              <CustomerList customers={result.data.customers} />
            )}
          </Card>

          <Pagination page={result.data.page} pageSize={PAGE_SIZE}
                      total={result.data.total} params={filters} />
        </>
      )}
    </>
  );
}
