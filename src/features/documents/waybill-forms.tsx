"use client";

import { RecordForm } from "@/components/ui/record-form";
import { issueWaybillAction, markWaybillDeliveredAction } from "./actions";
import { FileOutput, PenLine } from "lucide-react";

/**
 * Raising a waybill for a load that already went out.
 *
 * The choice is a load rather than a list of products: the lines are
 * copied from the load by the database, so the document cannot claim
 * something different from what was actually put on the van.
 */
export function IssueWaybillButton({
  loads,
}: {
  loads: { id: string; loadNumber: string; vanCode: string; driverName: string; loadDate: string }[];
}) {
  return (
    <RecordForm
      action={issueWaybillAction}
      trigger="Issue waybill"
      icon={<FileOutput className="size-4" aria-hidden />}
      title="Issue a waybill"
      description="The lines are taken from the load itself, so the document matches what went on the van."
      submitLabel="Issue waybill"
      disabled={loads.length === 0}
      fields={[
        {
          name: "loadId",
          label: "Van load",
          type: "select",
          required: true,
          options: loads.map((l) => ({
            value: l.id,
            label: `${l.loadNumber} · ${l.vanCode} · ${l.driverName}`,
          })),
          hint:
            loads.length === 0
              ? "Every dispatched load already has a waybill."
              : undefined,
        },
      ]}
    />
  );
}

/** Signing the goods in at the other end. */
export function MarkDeliveredButton({
  waybillId,
  waybillNumber,
}: {
  waybillId: string;
  waybillNumber: string;
}) {
  return (
    <RecordForm
      action={markWaybillDeliveredAction}
      trigger="Sign for delivery"
      variant="secondary"
      size="sm"
      icon={<PenLine className="size-4" aria-hidden />}
      title={`Sign for ${waybillNumber}`}
      description="Record who took the goods. This is what the waybill is evidence of."
      submitLabel="Record delivery"
      record={{ waybillId }}
      fields={[
        {
          name: "receivedBy",
          label: "Received by",
          required: true,
          placeholder: "Name of the person who signed",
        },
      ]}
    />
  );
}
