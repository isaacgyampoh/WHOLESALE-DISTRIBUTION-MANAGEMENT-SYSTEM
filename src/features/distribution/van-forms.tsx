"use client";

import { RecordForm } from "@/components/ui/record-form";
import { AssignCrewButton } from "./crew-forms";
import { ActionButton } from "@/components/ui/action-button";
import { saveVanAction, setVanActiveAction, assignDriverAction } from "./actions";
import { Plus, Pencil, UserCog } from "lucide-react";
import type { VanRow } from "./queries";

export interface Option { id: string; label: string }

const vanFields = (warehouses: Option[]) => [
  { name: "code", label: "Code", required: true, half: true, placeholder: "VAN1" },
  { name: "registrationNo", label: "Registration", required: true, half: true, placeholder: "GT-0001-24" },
  { name: "make", label: "Make", half: true, placeholder: "Toyota" },
  { name: "model", label: "Model", half: true, placeholder: "Hiace" },
  { name: "capacityKg", label: "Capacity (kg)", type: "decimal" as const, half: true },
  {
    name: "homeWarehouseId", label: "Home warehouse", type: "select" as const, half: true,
    options: warehouses.map((w) => ({ value: w.id, label: w.label })),
  },
] as const;

export function CreateVanButton({ warehouses }: { warehouses: Option[] }) {
  return (
    <RecordForm
      action={saveVanAction}
      fields={vanFields(warehouses)}
      trigger="Add van"
      title="Add a van"
      description="A vehicle that carries stock out to customers."
      submitLabel="Add van"
      icon={<Plus className="size-4" aria-hidden />}
    />
  );
}

export function VanActions({
  van, warehouses, drivers, salespeople = [],
}: {
  van: VanRow;
  warehouses: Option[];
  drivers: Option[];
  salespeople?: Option[];
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <RecordForm
        action={saveVanAction}
        fields={vanFields(warehouses)}
        record={{
          id: van.id, code: van.code, registrationNo: van.registrationNo,
          make: van.make, model: van.model, capacityKg: van.capacityKg,
        }}
        trigger="Edit"
        title={`Edit ${van.code}`}
        variant="outline"
        size="sm"
        icon={<Pencil className="size-3.5" aria-hidden />}
      />

      <RecordForm
        action={assignDriverAction}
        fields={[{
          name: "driverId", label: "Driver", type: "select" as const,
          hint: "Leave unchosen to take the current driver off this van.",
          options: drivers.map((d) => ({ value: d.id, label: d.label })),
        }]}
        record={{ vanId: van.id, driverId: van.driverId }}
        trigger="Driver"
        title={`Who drives ${van.code}?`}
        description="A driver holds one van at a time."
        submitLabel="Assign"
        variant="outline"
        size="sm"
        icon={<UserCog className="size-3.5" aria-hidden />}
      />

      {/*
        The step the whole round waits on. It used to live a page deeper,
        behind the van's own name, so a van could sit loaded with nobody
        crewed to sell from it and nothing on this screen said so.
      */}
      {salespeople.length > 0 && (
        <AssignCrewButton
          vanId={van.id}
          vanCode={van.code}
          crewRole="salesperson"
          people={salespeople.map((p) => ({ id: p.id, fullName: p.label, role: "salesperson" }))}
        />
      )}

      <ActionButton
        action={setVanActiveAction}
        fields={{ id: van.id, active: van.isActive ? "false" : "true" }}
        label={van.isActive ? "Retire" : "Return to service"}
        title={`${van.isActive ? "Retire" : "Return"} ${van.code}`}
        variant="outline"
        warning={
          van.isActive
            ? {
                title: "Only if it is empty",
                body: "A van still carrying stock cannot be retired. Bring it back on a return first.",
              }
            : undefined
        }
      />
    </div>
  );
}
