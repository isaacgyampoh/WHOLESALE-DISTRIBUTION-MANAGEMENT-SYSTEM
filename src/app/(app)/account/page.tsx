import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { ChangePinForm } from "@/features/staff/change-pin-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Your account" };

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator", senior_manager: "Senior manager", manager: "Manager",
  warehouse: "Warehouse", accountant: "Accountant",
  sales_rep: "Sales representative (office)", salesperson: "Salesperson (field)",
  driver: "Driver",
};

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <>
      <PageHeader title="Your account" breadcrumbs={[{ label: "Your account" }]} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Details" />
          <CardBody className="space-y-3 text-sm">
            <Row label="Name" value={user.fullName} />
            <Row label="Role" value={ROLE_LABELS[user.role] ?? user.role} />
            <p className="pt-1 text-xs text-[var(--text-muted)]">
              Your role decides what you can see. Only an administrator can change it.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Change your PIN"
            description="You will need your current PIN."
          />
          <CardBody>
            <ChangePinForm />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-medium text-[var(--text-primary)]">{value}</span>
    </div>
  );
}
