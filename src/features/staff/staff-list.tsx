"use client";

import { useActionState, useState } from "react";
import { resetStaffPinAction, type ResetPinState } from "@/lib/auth/actions";
import { DigitInput } from "@/components/ui/digit-input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { PIN_LENGTH } from "@/lib/auth/pin";
import type { StaffMember } from "./queries";
import { KeyRound, X } from "lucide-react";

const INITIAL: ResetPinState = { status: "idle" };

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator", senior_manager: "Senior manager", manager: "Manager",
  warehouse: "Warehouse", accountant: "Accountant", sales_rep: "Sales rep", driver: "Driver",
};

export function StaffList({ staff }: { staff: StaffMember[] }) {
  const [selected, setSelected] = useState<StaffMember | null>(null);
  const [state, submit, pending] = useActionState(resetStaffPinAction, INITIAL);

  return (
    <>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>PIN</Th>
              <Th>Status</Th>
              <Th numeric>Action</Th>
            </tr>
          </thead>
          <tbody>
            {staff.map((person) => (
              <Tr key={person.id}>
                <Td className="font-medium">{person.fullName}</Td>
                <Td>{ROLE_LABELS[person.role] ?? person.role}</Td>
                <Td>
                  {person.hasPin
                    ? <Badge tone="positive">Set</Badge>
                    : <Badge tone="caution">Not set</Badge>}
                </Td>
                <Td>
                  {person.isActive
                    ? <Badge tone="neutral">Active</Badge>
                    : <Badge tone="critical">Inactive</Badge>}
                </Td>
                <Td numeric>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setSelected(person)}
                  >
                    <KeyRound className="size-3.5" />
                    {person.hasPin ? "Reset PIN" : "Set PIN"}
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <div
            className="absolute inset-0 bg-ink-950/50"
            onClick={() => setSelected(null)}
            aria-hidden
          />
          <Card className="relative w-full max-w-sm">
            <CardHeader
              title={state.status === "done" ? "PIN updated" : `Set a PIN for ${selected.fullName}`}
              description={
                state.status === "done"
                  ? undefined
                  : `Exactly ${PIN_LENGTH} digits, and not already in use.`
              }
              action={
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                  className="grid size-11 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] pointer-fine:size-8"
                >
                  <X className="size-4" />
                </button>
              }
            />
            <CardBody className="space-y-4">
              {state.status === "done" && state.assignedPin ? (
                <>
                  <Alert tone="success" title={`${state.staffName} can now sign in`}>
                    Give them this PIN. It is shown once and cannot be read back
                    afterwards.
                  </Alert>
                  <p className="numeric rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] py-5 text-center text-3xl font-semibold tracking-[0.3em] text-[var(--text-primary)]">
                    {state.assignedPin}
                  </p>
                  <Button variant="outline" className="w-full" onClick={() => setSelected(null)}>
                    Done
                  </Button>
                </>
              ) : (
                <form action={submit} className="space-y-4">
                  <input type="hidden" name="profileId" value={selected.id} />
                  {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                      New PIN
                    </label>
                    <DigitInput length={PIN_LENGTH} name="pin" autoFocus disabled={pending} />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                      Confirm PIN
                    </label>
                    <DigitInput length={PIN_LENGTH} name="confirmPin" disabled={pending} />
                  </div>

                  <Button type="submit" size="lg" loading={pending} className="w-full">
                    Save PIN
                  </Button>
                </form>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
