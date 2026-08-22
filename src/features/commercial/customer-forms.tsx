"use client";

import { RecordForm } from "@/components/ui/record-form";
import { ActionButton } from "@/components/ui/action-button";
import { saveCustomerAction, setCustomerActiveAction } from "./actions";
import { Plus, Pencil } from "lucide-react";
import type { CustomerRow } from "./queries";

const CUSTOMER_FIELDS = [
  { name: "code", label: "Customer code", required: true, half: true, placeholder: "C001" },
  { name: "name", label: "Name", required: true, half: true },
  { name: "contactName", label: "Contact", half: true },
  { name: "phone", label: "Phone", half: true, placeholder: "+233..." },
  { name: "city", label: "City", half: true },
  { name: "region", label: "Region", half: true },
  {
    name: "creditLimit", label: "Credit limit", type: "decimal" as const, half: true,
    hint: "In Ghana Cedis. Zero means cash only.",
  },
  {
    name: "paymentTermsDays", label: "Payment terms (days)", type: "number" as const, half: true,
    hint: "How long they have to settle.",
  },
  { name: "billingAddress", label: "Address", type: "textarea" as const },
] as const;

export function CreateCustomerButton() {
  return (
    <RecordForm
      action={saveCustomerAction}
      fields={CUSTOMER_FIELDS}
      trigger="Add customer"
      title="Add a customer"
      description="Who a sale is recorded against."
      submitLabel="Add customer"
      icon={<Plus className="size-4" aria-hidden />}
    />
  );
}

export function CustomerActions({
  customer, canEdit,
}: {
  customer: CustomerRow;
  canEdit: boolean;
}) {
  if (!canEdit) return null;

  return (
    <div className="flex flex-wrap gap-2">
      <RecordForm
        action={saveCustomerAction}
        fields={CUSTOMER_FIELDS}
        record={{
          id: customer.id, code: customer.code, name: customer.name,
          contactName: customer.contactName, phone: customer.phone,
          city: customer.city, region: customer.region,
          creditLimit: customer.creditLimit, paymentTermsDays: customer.paymentTermsDays,
        }}
        trigger="Edit"
        title={`Edit ${customer.name}`}
        variant="outline"
        size="sm"
        icon={<Pencil className="size-3.5" aria-hidden />}
      />
      <ActionButton
        action={setCustomerActiveAction}
        fields={{ id: customer.id, active: customer.isActive ? "false" : "true" }}
        label={customer.isActive ? "Deactivate" : "Activate"}
        title={`${customer.isActive ? "Deactivate" : "Activate"} ${customer.name}`}
        description={
          customer.isActive
            ? "They stop being offered on new sales. Their history and balance stay."
            : "They can be sold to again."
        }
        variant="outline"
      />
    </div>
  );
}
