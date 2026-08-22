import type { Metadata } from "next";
import { ReturnForm } from "@/features/driver/return-form";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Return" };

export default function DriverReturnPage() {
  return (
    <>
      <PageHeader
        title="Bring the van back"
        description="Count what is left on board."
        breadcrumbs={[{ label: "My round", href: "/driver" }, { label: "Return" }]}
      />
      <ReturnForm />
    </>
  );
}
