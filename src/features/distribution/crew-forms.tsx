"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { assignCrewAction, removeCrewAction } from "./actions";
import { INITIAL_DISTRIBUTION_STATE } from "./state";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { UserPlus, UserMinus, Repeat } from "lucide-react";

interface Person { id: string; fullName: string; role: string }

/**
 * Putting somebody on a van.
 *
 * The job is fixed by whichever button opened this, rather than being a
 * third dropdown: "assign a driver" and "add a salesperson" are two
 * different intentions, and the list of people who can do each is
 * different too.
 */
export function AssignCrewButton({
  vanId,
  vanCode,
  crewRole,
  people,
  replacing,
}: {
  vanId: string;
  vanCode: string;
  crewRole: "driver" | "salesperson";
  people: Person[];
  /** The driver being replaced, if there already is one. */
  replacing?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    assignCrewAction, INITIAL_DISTRIBUTION_STATE);

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  const isDriver = crewRole === "driver";
  const label = isDriver ? (replacing ? "Replace driver" : "Assign driver") : "Add a salesperson";

  return (
    <>
      <Button
        size="sm"
        variant={isDriver && replacing ? "secondary" : "primary"}
        onClick={() => setOpen(true)}
        disabled={people.length === 0}
      >
        {isDriver && replacing
          ? <Repeat className="size-4" aria-hidden />
          : <UserPlus className="size-4" aria-hidden />}
        {label}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={`${label} — ${vanCode}`}
        description={
          isDriver
            ? "A van takes one driver. Assigning another stands the current one down."
            : "A van can have several people selling from it."
        }
      >
        {state.status === "done" ? (
          <div className="space-y-4">
            <Alert tone="success">{state.message}</Alert>
            <Button className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            {state.status === "error" && state.message && (
              <Alert tone="danger">{state.message}</Alert>
            )}

            <input type="hidden" name="vanId" value={vanId} />
            <input type="hidden" name="crewRole" value={crewRole} />

            {isDriver && replacing && (
              <Alert tone="warning">
                {replacing} is driving {vanCode} at the moment. They will be stood down.
              </Alert>
            )}

            <Field
              label={isDriver ? "Driver" : "Salesperson"}
              htmlFor="memberId"
              required
              hint={
                people.length === 0
                  ? "Nobody with that job is active. Create them under Staff first."
                  : "Somebody already on another van will be moved to this one."
              }
              error={state.fieldErrors?.memberId}
            >
              <Select id="memberId" name="memberId" required>
                <option value="">Choose somebody</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.fullName}</option>
                ))}
              </Select>
            </Field>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" loading={pending}>
                {isDriver && replacing ? "Replace them" : "Put them on"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

/**
 * Taking somebody off a van.
 *
 * Confirmed rather than done on one tap: a salesperson stood down
 * mid-round loses access to the van's stock and cannot record what they
 * have already sold.
 */
export function RemoveCrewButton({
  assignmentId,
  memberName,
  vanCode,
  crewRole,
}: {
  assignmentId: string;
  memberName: string;
  vanCode: string;
  crewRole: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    removeCrewAction, INITIAL_DISTRIBUTION_STATE);

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}
              aria-label={`Take ${memberName} off ${vanCode}`}>
        <UserMinus className="size-4" aria-hidden />
        Take off
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={`Take ${memberName} off ${vanCode}?`}
        description={
          crewRole === "driver"
            ? "The van will have no driver and cannot be dispatched until another is assigned."
            : "They will lose access to this van's stock and cannot record any more sales from it."
        }
      >
        {state.status === "done" ? (
          <div className="space-y-4">
            <Alert tone="success">{state.message}</Alert>
            <Button className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            {state.status === "error" && state.message && (
              <Alert tone="danger">{state.message}</Alert>
            )}

            <input type="hidden" name="assignmentId" value={assignmentId} />

            <Alert tone="warning">
              Anything {memberName} has already sold stays on the record against them. This
              only stops them selling any more from {vanCode}.
            </Alert>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={close} disabled={pending}>
                Keep them on
              </Button>
              <Button type="submit" variant="danger" className="flex-1" loading={pending}>
                Take them off
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
