"use client";

import { RecordForm } from "@/components/ui/record-form";
import { ActionButton } from "@/components/ui/action-button";
import {
  saveWarehouseAction, setWarehouseActiveAction,
  saveSupplierAction, setSupplierActiveAction,
} from "./actions";
import { Plus, Pencil } from "lucide-react";
import type { WarehouseRow, SupplierRow } from "./queries";

const WAREHOUSE_FIELDS = [
  { name: "code", label: "Code", required: true, half: true, placeholder: "WH1" },
  { name: "name", label: "Name", required: true, half: true, placeholder: "Main Depot" },
  { name: "city", label: "City", half: true },
  { name: "address", label: "Address", type: "textarea" as const },
] as const;

export function CreateWarehouseButton() {
  return (
    <RecordForm
      action={saveWarehouseAction}
      fields={WAREHOUSE_FIELDS}
      trigger="Add warehouse"
      title="Add a warehouse"
      description="Somewhere stock is physically held."
      submitLabel="Add warehouse"
      icon={<Plus className="size-4" aria-hidden />}
    />
  );
}

export function WarehouseActions({ warehouse }: { warehouse: WarehouseRow }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <RecordForm
        action={saveWarehouseAction}
        fields={WAREHOUSE_FIELDS}
        record={{
          id: warehouse.id, code: warehouse.code, name: warehouse.name,
          city: warehouse.city, address: warehouse.address,
        }}
        trigger="Edit"
        title={`Edit ${warehouse.name}`}
        variant="outline"
        size="sm"
        icon={<Pencil className="size-3.5" aria-hidden />}
      />
      <ActionButton
        action={setWarehouseActiveAction}
        fields={{ id: warehouse.id, active: warehouse.isActive ? "false" : "true" }}
        label={warehouse.isActive ? "Deactivate" : "Activate"}
        title={`${warehouse.isActive ? "Deactivate" : "Activate"} ${warehouse.name}`}
        description={
          warehouse.isActive
            ? "It stops being offered for new stock movements."
            : "It becomes available again."
        }
        variant="outline"
        warning={
          warehouse.isActive
            ? {
                title: "Only if it is empty",
                body: "A warehouse still holding stock cannot be closed. Transfer or adjust it out first.",
              }
            : undefined
        }
      />
    </div>
  );
}

const SUPPLIER_FIELDS = [
  { name: "code", label: "Code", required: true, half: true, placeholder: "SUP1" },
  { name: "name", label: "Name", required: true, half: true },
  { name: "contactName", label: "Contact", half: true },
  { name: "phone", label: "Phone", half: true, placeholder: "+233..." },
  { name: "email", label: "Email", half: true },
  { name: "paymentTermsDays", label: "Payment terms (days)", type: "number" as const, half: true },
  { name: "leadTimeDays", label: "Lead time (days)", type: "number" as const, half: true },
] as const;

export function CreateSupplierButton() {
  return (
    <RecordForm
      action={saveSupplierAction}
      fields={SUPPLIER_FIELDS}
      trigger="Add supplier"
      title="Add a supplier"
      description="Somebody the business buys from."
      submitLabel="Add supplier"
      variant="outline"
      size="sm"
      icon={<Plus className="size-3.5" aria-hidden />}
    />
  );
}

export function SupplierActions({ supplier }: { supplier: SupplierRow }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <RecordForm
        action={saveSupplierAction}
        fields={SUPPLIER_FIELDS}
        record={{
          id: supplier.id, code: supplier.code, name: supplier.name,
          contactName: supplier.contactName, phone: supplier.phone,
          paymentTermsDays: supplier.paymentTermsDays, leadTimeDays: supplier.leadTimeDays,
        }}
        trigger="Edit"
        title={`Edit ${supplier.name}`}
        variant="ghost"
        size="sm"
      />
      <ActionButton
        action={setSupplierActiveAction}
        fields={{ id: supplier.id, active: supplier.isActive ? "false" : "true" }}
        label={supplier.isActive ? "Deactivate" : "Activate"}
        title={`${supplier.isActive ? "Deactivate" : "Activate"} ${supplier.name}`}
        variant="ghost"
      />
    </div>
  );
}
