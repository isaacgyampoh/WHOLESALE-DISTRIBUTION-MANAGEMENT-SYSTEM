import type { Metadata } from "next";
import { SellForm } from "@/features/driver/sell-form";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Sell" };

export default function DriverSellPage() {
  return (
    <>
      <PageHeader
        title="Sell from the van"
        description="Works with or without a signal."
        breadcrumbs={[{ label: "My round", href: "/driver" }, { label: "Sell" }]}
      />
      <SellForm />
    </>
  );
}
