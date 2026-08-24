"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createStaffAction, resetStaffPinAction } from "./actions";
import { INITIAL_STAFF_STATE } from "./state";
import { DigitInput } from "@/components/ui/digit-input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Field } from "@/components/ui/field";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { PinReveal } from "./pin-reveal";
import { ROLE_LABELS } from "./shared";
import { PIN_LENGTH, suggestUsername } from "@/lib/auth/pin";
import { USER_ROLES } from "@/types/domain";
import { formatDate } from "@/lib/utils/format";
import type { StaffMember } from "./queries";
import { KeyRound, UserPlus, ChevronRight } from "lucide-react";

/**
 * The roster.
 *
 * A table on a desktop, where an administrator is comparing people, and
 * cards on a phone, where a table would be unreadable. Both are the same
 * data; neither is a cut-down version of the other.
 */
export function StaffList({ staff }: { staff: StaffMember[] }) {
  const [resetting, setResetting] = useState<StaffMember | null>(null);

  return (
    <>
      {/* Desktop: density matters, so a table. */}
      <TableWrap className="hidden pointer-fine:block">
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>PIN</Th>
              <Th>Status</Th>
              <Th>Created</Th>
              <Th numeric>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {staff.map((person) => (
              <Tr key={person.id}>
                <Td>
                  <Link
                    href={`/users/${person.id}`}
                    className="font-medium text-[var(--text-primary)] hover:text-brand-700 hover:underline dark:hover:text-brand-300"
                  >
                    {person.fullName}
                  </Link>
                  {person.username && (
                    <span className="block text-xs text-[var(--text-secondary)]">
                      {person.username}
                    </span>
                  )}
                  {person.phone && (
                    <span className="numeric block text-xs text-[var(--text-muted)]">
                      {person.phone}
                    </span>
                  )}
                </Td>
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
                <Td className="numeric text-[var(--text-secondary)]">
                  {formatDate(person.createdAt)}
                </Td>
                <Td numeric>
                  <Button size="sm" variant="outline" onClick={() => setResetting(person)}>
                    <KeyRound className="size-3.5" />
                    {person.hasPin ? "Reset PIN" : "Set PIN"}
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      {/* Phone: cards, because six columns on a 390px screen is unusable. */}
      <ul className="space-y-2 pointer-fine:hidden">
        {staff.map((person) => (
          <li key={person.id}>
            <Link
              href={`/users/${person.id}`}
              className="surface flex items-center gap-3 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-[var(--text-primary)]">
                  {person.fullName}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  {ROLE_LABELS[person.role] ?? person.role}
                  {person.username ? ` · ${person.username}` : ""}
                </p>
                <div className="mt-2 flex gap-1.5">
                  {person.isActive
                    ? <Badge tone="neutral">Active</Badge>
                    : <Badge tone="critical">Inactive</Badge>}
                  {person.hasPin
                    ? <Badge tone="positive">PIN set</Badge>
                    : <Badge tone="caution">No PIN</Badge>}
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      <ResetPinDialog member={resetting} onClose={() => setResetting(null)} />
    </>
  );
}

export function CreateStaffButton({ canManageRoles }: { canManageRoles: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(createStaffAction, INITIAL_STAFF_STATE);
  const done = state.status === "done" && state.revealedPin;

  // The username follows the name until somebody types one, so the
  // common case needs no thought and the unusual case is still possible.
  const [fullName, setFullName] = useState("");
  const [username, setUsernameRaw] = useState("");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const setUsername = (v: string) => setUsernameRaw(v.toLowerCase());

  const onNameChange = (value: string) => {
    setFullName(value);
    if (!usernameEdited) setUsernameRaw(suggestUsername(value));
  };

  const onClose = () => {
    setOpen(false);
    setFullName("");
    setUsernameRaw("");
    setUsernameEdited(false);
  };

  return (
    <>
    <Button onClick={() => setOpen(true)}>
      <UserPlus className="size-4" />
      Create staff
    </Button>
    <Dialog
      open={open}
      onClose={onClose}
      title={done ? "Staff created" : "Create staff"}
      description={done ? undefined : "They will sign in with the username and PIN you set here."}
    >
      {done ? (
        <PinReveal
          staffName={state.staffName ?? "Staff member"}
          username={state.username}
          pin={state.revealedPin!}
          onDone={onClose}
        />
      ) : (
        <form action={submit} className="space-y-4">
          {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}

          <Field label="Full name" htmlFor="fullName" required>
            <Input
              id="fullName"
              name="fullName"
              required
              autoComplete="off"
              placeholder="John Mensah"
              value={fullName}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </Field>

          <Field
            label="Username"
            htmlFor="username"
            required
            hint="What they type to sign in. Letters and numbers, with dots, hyphens or underscores between them."
          >
            <Input
              id="username"
              name="username"
              required
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="john.mensah"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setUsernameEdited(true); }}
            />
          </Field>

          <Field label="Role" htmlFor="role" required>
            <Select id="role" name="role" required defaultValue="driver">
              {USER_ROLES
                // Only an administrator may create an administrator; the
                // server refuses it too, this just avoids offering it.
                .filter((r) => canManageRoles || (r !== "admin" && r !== "senior_manager"))
                .map((role) => (
                  <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                ))}
            </Select>
          </Field>

          <Field label="Phone" htmlFor="phone" hint="Optional. Used for contact, not for signing in.">
            <Input id="phone" name="phone" type="tel" inputMode="tel" placeholder="+233241110000" />
          </Field>

          <div>
            <label
              htmlFor="new-staff-pin-0"
              className="mb-2 block text-sm font-medium text-[var(--text-primary)]"
            >
              {PIN_LENGTH}-digit PIN
            </label>
            <DigitInput
              idPrefix="new-staff-pin"
              label="PIN"
              length={PIN_LENGTH}
              name="pin"
              disabled={pending}
            />
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              A starting PIN. They will be asked to choose their own the first
              time they sign in, and this one stops working then.
            </p>
          </div>

          <div>
            <label
              htmlFor="new-staff-confirm-0"
              className="mb-2 block text-sm font-medium text-[var(--text-primary)]"
            >
              Confirm PIN
            </label>
            <DigitInput
              idPrefix="new-staff-confirm"
              label="Confirm PIN"
              length={PIN_LENGTH}
              name="confirmPin"
              disabled={pending}
            />
          </div>

          <Button type="submit" size="lg" loading={pending} className="w-full">
            Create staff
          </Button>
        </form>
      )}
    </Dialog>
    </>
  );
}

function ResetPinDialog({
  member, onClose,
}: {
  member: StaffMember | null;
  onClose: () => void;
}) {
  const [state, submit, pending] = useActionState(resetStaffPinAction, INITIAL_STAFF_STATE);
  const done = state.status === "done" && state.revealedPin;

  return (
    <Dialog
      open={Boolean(member)}
      onClose={onClose}
      title={done ? "PIN updated" : `Set a PIN for ${member?.fullName ?? ""}`}
      description={done ? undefined : `Exactly ${PIN_LENGTH} digits, and not already in use.`}
    >
      {done ? (
        <PinReveal
          staffName={state.staffName ?? "Staff member"}
          username={state.username}
          pin={state.revealedPin!}
          onDone={onClose}
        />
      ) : (
        <form action={submit} className="space-y-4">
          <input type="hidden" name="profileId" value={member?.id ?? ""} />
          {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}

          <div>
            <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
              New PIN
            </label>
            <DigitInput length={PIN_LENGTH} name="pin" disabled={pending} />
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
    </Dialog>
  );
}
