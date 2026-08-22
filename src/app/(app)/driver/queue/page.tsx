import type { Metadata } from "next";
import { QueueList } from "@/features/driver/queue-list";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "My records" };

export default function DriverQueuePage() {
  return (
    <>
      <PageHeader
        title="Everything I have recorded"
        description="What has reached the office, and what is still waiting."
        breadcrumbs={[{ label: "My round", href: "/driver" }, { label: "My records" }]}
      />
      <QueueList />
    </>
  );
}
