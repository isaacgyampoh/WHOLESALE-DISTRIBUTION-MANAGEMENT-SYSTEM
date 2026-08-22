import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { getCustomer, listSales, listPayments } from "@/features/commercial/queries";
import { SalesList } from "@/features/commercial/sales-list";
import { PaymentList } from "@/features/commercial/payment-list";
import { CustomerActions } from "@/features/commercial/customer-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatMoney } from "@/lib/utils/format";
import { Receipt, Banknote } from "lucide-react";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "customers.view")) return <Forbidden />;

  const { id } = await params;
  const result = await getCustomer(id);

  if (!result.ok) {
    return <Card><ErrorState title="Customer could not be loaded" message={result.message} /></Card>;
  }
  // A row the caller cannot see and a row that does not exist are the
  // same answer here, deliberately: RLS has already filtered the read.
  if (!result.data) notFound();

  const customer = result.data;
  const [sales, payments] = await Promise.all([
    listSales({ customerId: id, page: 1 }),
    listPayments({ page: 1 }),
  ]);

  const theirPayments = payments.ok
    ? payments.data.payments.filter((p) => p.customerName === customer.name)
    : [];

  return (
    <>
      <PageHeader
        title={customer.name}
        description={`${customer.code}${customer.contactName ? ` · ${customer.contactName}` : ""}`}
        breadcrumbs={[
          { label: "Commercial" },
          { label: "Customers", href: "/customers" },
          { label: customer.name },
        ]}
        actions={<CustomerActions customer={customer} canEdit={can(user.role, "customers.edit")} />}
      />

      <StatGrid>
        <StatTile label="Outstanding" value={formatMoney(customer.balance)}
                  sub="Owed right now"
                  tone={customer.balance > 0 ? "caution" : "positive"} />
        <StatTile label="Credit limit" value={formatMoney(customer.creditLimit)}
                  sub={`${customer.paymentTermsDays} day terms`} />
        <StatTile label="Credit available" value={formatMoney(customer.creditAvailable)}
                  sub={customer.overLimit ? "Over the limit" : "Headroom remaining"}
                  tone={customer.overLimit ? "critical" : "neutral"} />
        <StatTile label="Oldest overdue"
                  value={customer.daysPastDue ? `${customer.daysPastDue} days` : "None"}
                  sub="Past the due date"
                  tone={(customer.daysPastDue ?? 0) > 0 ? "critical" : "positive"} />
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Details" />
          <CardBody className="space-y-3 text-sm">
            <Row label="Customer code" value={customer.code} numeric />
            <Row label="Contact" value={customer.contactName ?? "-"} />
            <Row label="Phone" value={customer.phone ?? "-"} numeric />
            <Row label="Location" value={[customer.city, customer.region].filter(Boolean).join(", ") || "-"} />
            <Row label="Price tier" value={customer.priceTier} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--text-secondary)]">Status</span>
              <div className="flex flex-wrap justify-end gap-1.5">
                <Badge tone={customer.isActive ? "positive" : "neutral"}>
                  {customer.isActive ? "Active" : "Inactive"}
                </Badge>
                {customer.overLimit && <Badge tone="critical">Over limit</Badge>}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title="Sales" description="Everything sold to this customer." />
          {!sales.ok ? (
            <ErrorState title="Sales unavailable" message={sales.message} />
          ) : sales.data.sales.length === 0 ? (
            <EmptyState icon={Receipt} title="No sales yet"
                        description="Nothing has been sold to this customer." />
          ) : (
            <SalesList sales={sales.data.sales} />
          )}
        </Card>
      </div>

      <div className="mt-5">
        <Card className="overflow-hidden">
          <CardHeader title="Collections" description="Money received from this customer." />
          {theirPayments.length === 0 ? (
            <EmptyState icon={Banknote} title="No collections yet"
                        description="Nothing has been received against their account." />
          ) : (
            <PaymentList payments={theirPayments} />
          )}
        </Card>
      </div>
    </>
  );
}

function Row({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className={numeric ? "numeric text-[var(--text-primary)]" : "text-[var(--text-primary)]"}>
        {value}
      </span>
    </div>
  );
}
