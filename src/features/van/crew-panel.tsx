"use client";

import { useActionState, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { assignCrewAction, removeCrewAction, INITIAL_CREW_STATE } from "./crew-actions";
import type { FleetVan, StaffOption } from "./fleet-queries";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";

/**
 * Who is on this van.
 *
 * Two seats, named for what the person does: the driver keeps the van,
 * the salesperson sells from it. Somebody already crewed elsewhere is
 * shown with their current van rather than hidden, so it is obvious why
 * they cannot be picked.
 */
export function CrewPanel({ van, candidates }: { van: FleetVan; candidates: StaffOption[] }) {
  const [adding, setAdding] = useState<"driver" | "salesperson" | null>(null);

  const driver = van.crew.find((c) => c.crewRole === "driver");
  const sellers = van.crew.filter((c) => c.crewRole === "salesperson");

  return (
    <div className="space-y-3">
      <Seat
        label="Driver"
        hint="Keeps the van. Cannot sell."
        members={driver ? [driver] : []}
        vanLabel={van.code}
        onAdd={() => setAdding("driver")}
        addLabel="Assign driver"
        canAdd={!driver}
      />
      <Seat
        label="Salesperson"
        hint="Sells from this van's stock."
        members={sellers}
        vanLabel={van.code}
        onAdd={() => setAdding("salesperson")}
        addLabel="Assign salesperson"
        canAdd
      />

      <AssignDialog
        open={adding !== null}
        crewRole={adding ?? "driver"}
        van={van}
        candidates={candidates}
        onClose={() => setAdding(null)}
      />
    </div>
  );
}

function Seat({
  label, hint, members, vanLabel, onAdd, addLabel, canAdd,
}: {
  label: string;
  hint: string;
  members: FleetVan["crew"];
  vanLabel: string;
  onAdd: () => void;
  addLabel: string;
  canAdd: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p>
        {canAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
          >
            <UserPlus className="size-3" aria-hidden />
            {addLabel}
          </button>
        )}
      </div>
      {members.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">{hint}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {members.map((m) => (
            <li key={m.assignmentId} className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">{m.name}</span>
              <RemoveButton assignmentId={m.assignmentId} vanLabel={vanLabel} name={m.name} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RemoveButton({
  assignmentId, vanLabel, name,
}: {
  assignmentId: string;
  vanLabel: string;
  name: string;
}) {
  const [state, submit, pending] = useActionState(removeCrewAction, INITIAL_CREW_STATE);

  return (
    <form action={submit}>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="vanLabel" value={vanLabel} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Take ${name} off ${vanLabel}`}
        title={state.status === "error" ? state.message : `Take ${name} off ${vanLabel}`}
        className="grid size-8 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-critical disabled:opacity-50"
      >
        <X className="size-3.5" />
      </button>
    </form>
  );
}

function AssignDialog({
  open, crewRole, van, candidates, onClose,
}: {
  open: boolean;
  crewRole: "driver" | "salesperson";
  van: FleetVan;
  candidates: StaffOption[];
  onClose: () => void;
}) {
  const [state, submit, pending] = useActionState(assignCrewAction, INITIAL_CREW_STATE);

  const wanted = crewRole === "driver" ? "driver" : "sales_rep";
  const eligible = candidates.filter((c) => c.role === wanted);
  const free = eligible.filter((c) => !c.assignedVanCode);

  if (state.status === "done" && open) onClose();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={crewRole === "driver" ? "Assign a driver" : "Assign a salesperson"}
      description={`${van.code} - ${van.registration}`}
    >
      <form action={submit} className="space-y-4">
        <input type="hidden" name="vanId" value={van.id} />
        <input type="hidden" name="vanLabel" value={van.code} />
        <input type="hidden" name="crewRole" value={crewRole} />

        {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}

        {eligible.length === 0 ? (
          <Alert tone="warning">
            {crewRole === "driver"
              ? "There are no active drivers to assign. Create one under Staff first."
              : "There are no active salespeople to assign. Create one under Staff first."}
          </Alert>
        ) : (
          <>
            <Field
              label={crewRole === "driver" ? "Driver" : "Salesperson"}
              required
              htmlFor="memberId"
              hint="Someone already on another van has to come off it first."
            >
              <Select id="memberId" name="memberId" required defaultValue="">
                <option value="" disabled>Choose a person</option>
                {eligible.map((c) => (
                  <option key={c.id} value={c.id} disabled={Boolean(c.assignedVanCode)}>
                    {c.name}
                    {c.assignedVanCode ? ` - already on ${c.assignedVanCode}` : ""}
                  </option>
                ))}
              </Select>
            </Field>

            {free.length === 0 && (
              <Alert tone="warning">Everyone with that job is already on a van.</Alert>
            )}

            {crewRole === "salesperson" && (
              <Alert tone="info">
                Once assigned, this person sells from {van.code} and sees only
                {" "}{van.code}&apos;s stock on their Sell screen.
              </Alert>
            )}

            <div className="flex gap-2">
              <Button type="submit" loading={pending} disabled={free.length === 0} className="flex-1">
                Assign
              </Button>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </form>
    </Dialog>
  );
}

export function CrewBadges({ van }: { van: FleetVan }) {
  const driver = van.crew.find((c) => c.crewRole === "driver");
  const sellers = van.crew.filter((c) => c.crewRole === "salesperson");
  return (
    <div className="flex flex-wrap gap-1">
      {driver ? (
        <Badge tone="info">Driver: {driver.name}</Badge>
      ) : (
        <Badge tone="neutral">No driver</Badge>
      )}
      {sellers.length > 0 ? (
        sellers.map((s) => <Badge key={s.profileId} tone="brand">Sells: {s.name}</Badge>)
      ) : (
        <Badge tone="caution">No salesperson</Badge>
      )}
    </div>
  );
}
