import type { Metadata } from "next";
import { VanStock } from "@/features/driver/van-stock";
import { getSellingRound } from "@/features/driver/queries";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "My van stock" };

export default async function DriverStockPage() {
  const round = await getSellingRound();

  return (
    <>
      <PageHeader
        title="My van stock"
        description="What is still on board, and what you charge for it."
        breadcrumbs={[{ label: "My round", href: "/driver" }, { label: "Van stock" }]}
      />
      <VanStock initial={round.ok ? round.data : null} />
    </>
  );
}
