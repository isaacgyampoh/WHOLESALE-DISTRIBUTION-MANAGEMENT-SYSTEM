import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { getMySalesContext, getSellableStock, getCustomers } from "@/features/selling/queries";
import { SellScreen } from "@/features/selling/sell-screen";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { toAppError } from "@/lib/errors/app-error";
import { Ban } from "lucide-react";

export const metadata: Metadata = { title: "Sell" };

export default async function SellPage() {
  // A driver does not hold sales.create, so they never reach this page.
  // The database refuses them a sale as well, which is the check that
  // actually matters.
  await requirePermission("sales.create");

  let context;
  try {
    context = await getMySalesContext();
  } catch (error) {
    console.error("[sell] could not resolve selling location", error);
    return (
      <>
        <PageHeader title="Sell" />
        <Card>
          <ErrorState title="Selling is unavailable" message={toAppError(error).userMessage} />
        </Card>
      </>
    );
  }

  if (!context || context.blockedReason) {
    return (
      <>
        <PageHeader title="Sell" />
        <Card>
          <EmptyState
            icon={Ban}
            title="There is nowhere for you to sell from"
            description={
              context?.blockedReason ??
              "You have no active van assignment and no shop location. Ask a manager to assign you."
            }
            action={
              <Link href="/" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
                Back to the dashboard
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const [products, customers] = await Promise.all([
    getSellableStock(context),
    getCustomers(),
  ]);

  return (
    <>
      <PageHeader
        title="Sell"
        description={
          context.kind === "van"
            ? `Everything below is on ${context.locationName} right now.`
            : `Selling from ${context.locationName}.`
        }
      />
      <SellScreen context={context} products={products} customers={customers} />
    </>
  );
}
