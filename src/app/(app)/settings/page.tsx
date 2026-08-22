import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/types/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Forbidden } from "@/components/layout/forbidden";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, ErrorState } from "@/components/ui/states";
import { ChevronRight } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { formatDate, formatMoney } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Settings" };

/**
 * Company settings.
 *
 * Read-only on purpose. The organization row governs tenancy, currency
 * and the country a document number is formatted for; changing it from
 * a web form would let one mistake move every record in the system into
 * a different tenant's shape. It is shown here so an administrator can
 * confirm what the installation is set to.
 */
export default async function SettingsPage() {
  const user = await requireUser();
  if (!can(user.role, "users.manage")) return <Forbidden />;

  const supabase = await createSupabaseServerClient();
  const [org, counts] = await Promise.all([
    supabase
      .from("organizations")
      .select("name, slug, country, currency, is_active, created_at")
      .eq("id", user.organizationId)
      .maybeSingle(),
    Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("products").select("id", { count: "exact", head: true }),
      supabase.from("customers").select("id", { count: "exact", head: true }),
      supabase.from("warehouses").select("id", { count: "exact", head: true }),
    ]),
  ]);

  if (org.error) {
    return (
      <>
        <PageHeader title="Settings" breadcrumbs={[{ label: "Insight" }, { label: "Settings" }]} />
        <Card>
          <ErrorState
            title="Settings could not be loaded"
            message="The company record could not be read. Please try again."
          />
        </Card>
      </>
    );
  }

  const [staff, products, customers, warehouses] = counts;

  return (
    <>
      <PageHeader
        title="Settings"
        description="How this installation is configured."
        breadcrumbs={[{ label: "Insight" }, { label: "Settings" }]}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Company" description="The organization every record belongs to." />
          <CardBody className="space-y-3 text-sm">
            <Row label="Trading name" value={BRAND.name} />
            <Row label="Registered as" value={org.data?.name ?? "-"} />
            <Row label="Identifier" value={org.data?.slug ?? "-"} numeric />
            <Row label="Country" value={org.data?.country ?? "-"} />
            <Row label="Currency" value={`${org.data?.currency ?? "GHS"} · ${formatMoney(1250)}`} numeric />
            <Row label="Created" value={formatDate(org.data?.created_at)} numeric />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--text-secondary)]">Status</span>
              <Badge tone={org.data?.is_active ? "positive" : "critical"}>
                {org.data?.is_active ? "Active" : "Suspended"}
              </Badge>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="What is in the system" description="Records this organization holds." />
          <CardBody className="space-y-3 text-sm">
            <Row label="Staff accounts" value={String(staff.count ?? 0)} numeric />
            <Row label="Products" value={String(products.count ?? 0)} numeric />
            <Row label="Customers" value={String(customers.count ?? 0)} numeric />
            <Row label="Warehouses" value={String(warehouses.count ?? 0)} numeric />
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 space-y-4">
        <Alert tone="info" title="Company details are set at installation">
          Currency, country and the organization identifier decide how every
          existing record is read. They are changed by an administrator against
          the database, not from this screen, so a single mistake here cannot
          move the whole system into a shape its data does not match.
        </Alert>

        <Card className="overflow-hidden">
          <CardHeader
            title="Where the rest of the configuration lives"
            description="Nothing here is duplicated; each of these is the screen that owns it."
          />
          {/* Rows rather than links inside a sentence: an inline link is
              about 17px tall, which is not a target a thumb can hit. */}
          <ul className="divide-y divide-[var(--border-subtle)]">
            {[
              ["/permissions", "Permissions", "What each role may do."],
              ["/users", "Staff", "Accounts, their roles, and a manager's category access."],
              ["/audit", "Audit trail", "Every change to either, and who made it."],
            ].map(([href, label, description]) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex min-h-11 items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-[var(--surface-sunken)]"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-[var(--text-primary)]">
                      {label}
                    </span>
                    <span className="block text-xs text-[var(--text-secondary)]">
                      {description}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
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
