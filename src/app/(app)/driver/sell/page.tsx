import type { Metadata } from "next";
import { SellForm } from "@/features/driver/sell-form";
import { getSellingRound, diagnoseRound } from "@/features/driver/queries";
import { getCapabilities } from "@/lib/db/capabilities";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Sell" };

export default async function DriverSellPage() {
  // Rendered server-side so the till has the round on first paint. The
  // device's cached copy takes over for the offline case.
  const [round, capabilities] = await Promise.all([getSellingRound(), getCapabilities()]);

  // Why there is nothing to sell, when there is nothing to sell. Only
  // asked in that case: it is three more queries and the answer is
  // uninteresting when the round is fine.
  const blocker = round.ok && round.data?.load ? null : await diagnoseRound();

  return (
    <>
      {/*
        Hidden on a phone, which is the only place this screen is
        actually used. It was two hundred pixels of title above a till
        that could show one product.
      */}
      <div className="hidden sm:block">
        <PageHeader
          title="Sell from the van"
          description="Works with or without a signal."
          breadcrumbs={[{ label: "My round", href: "/driver" }, { label: "Sell" }]}
        />
      </div>
      <SellForm
        initial={round.ok ? round.data : null}
        canRecordMethods={capabilities.salePaymentMethods}
        blocker={blocker}
      />
    </>
  );
}
