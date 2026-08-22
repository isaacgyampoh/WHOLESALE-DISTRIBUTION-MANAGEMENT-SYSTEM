import type { Metadata } from "next";
import { SellForm } from "@/features/driver/sell-form";
import { getSellingRound } from "@/features/driver/queries";
import { getCapabilities } from "@/lib/db/capabilities";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Sell" };

export default async function DriverSellPage() {
  // Rendered server-side so the till has the round on first paint. The
  // device's cached copy takes over for the offline case.
  const [round, capabilities] = await Promise.all([getSellingRound(), getCapabilities()]);

  return (
    <>
      <PageHeader
        title="Sell from the van"
        description="Works with or without a signal."
        breadcrumbs={[{ label: "My round", href: "/driver" }, { label: "Sell" }]}
      />
      <SellForm
        initial={round.ok ? round.data : null}
        canRecordMethods={capabilities.salePaymentMethods}
      />
    </>
  );
}
