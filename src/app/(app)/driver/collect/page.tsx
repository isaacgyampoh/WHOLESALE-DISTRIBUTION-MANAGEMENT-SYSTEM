import type { Metadata } from "next";
import { CollectForm } from "@/features/driver/collect-form";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Collect" };

export default function DriverCollectPage() {
  return (
    <>
      <PageHeader
        title="Take a payment"
        description="Money received against a customer's account."
        breadcrumbs={[{ label: "My round", href: "/driver" }, { label: "Collect" }]}
      />
      <CollectForm />
    </>
  );
}
