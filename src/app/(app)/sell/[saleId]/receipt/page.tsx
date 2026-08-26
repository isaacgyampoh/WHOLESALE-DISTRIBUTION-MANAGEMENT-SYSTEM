import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { getReceipt } from "@/features/selling/receipt-queries";
import { ReceiptView } from "@/features/selling/receipt-view";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/states";

export const metadata: Metadata = { title: "Receipt" };

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ saleId: string }>;
}) {
  await requirePermission("sales.view");
  const { saleId } = await params;

  // Row level security decides this, not the route: a sale belonging to
  // someone else's van reads as missing.
  const receipt = await getReceipt(saleId);
  if (!receipt) notFound();

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Sale complete"
          description="The stock has left and the customer's copy is below."
          breadcrumbs={[{ label: "Sell", href: "/sell" }, { label: receipt.saleNumber }]}
        />
        {receipt.saleType === "credit" && receipt.balance > 0 && (
          <div className="mb-4">
            <Alert tone="warning" title="Sold on credit">
              The balance has been added to {receipt.customerName}&apos;s account.
            </Alert>
          </div>
        )}
      </div>

      <ReceiptView receipt={receipt} />

      <div className="mt-6 text-center print:hidden">
        <Link href="/sell" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
          Start another sale
        </Link>
      </div>
    </>
  );
}
