"use client";

import { useActionState, useState } from "react";
import {
  setStaffActiveAction, changeRoleAction, setManagerCategoriesAction,
  resetStaffPinAction, INITIAL_STAFF_STATE,
} from "./actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { Dialog } from "@/components/ui/dialog";
import { DigitInput } from "@/components/ui/digit-input";
import { PinReveal } from "./pin-reveal";
import { ROLE_LABELS } from "./shared";
import { PIN_LENGTH } from "@/lib/auth/pin";
import { USER_ROLES } from "@/types/domain";
import type { StaffMember, CategoryOption } from "./queries";
import { KeyRound, ShieldCheck, Power } from "lucide-react";

/**
 * What an administrator can change about one person.
 *
 * Each control is its own form posting to its own action, so a failure
 * in one does not discard what was typed in another, and each action
 * re-checks its own permission on the server.
 */
export function StaffDetail({
  member,
  categories,
  canManageRoles,
  isSelf,
}: {
  member: StaffMember;
  categories: CategoryOption[] | null;
  canManageRoles: boolean;
  isSelf: boolean;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <RoleCard member={member} canManageRoles={canManageRoles} isSelf={isSelf} />
      <AccessCard member={member} isSelf={isSelf} />
      {member.role === "manager" && categories && (
        <div className="lg:col-span-2">
          <CategoryCard member={member} categories={categories} canManageRoles={canManageRoles} isSelf={isSelf} />
        </div>
      )}
    </div>
  );
}

function RoleCard({
  member, canManageRoles, isSelf,
}: { member: StaffMember; canManageRoles: boolean; isSelf: boolean }) {
  const [state, submit, pending] = useActionState(changeRoleAction, INITIAL_STAFF_STATE);

  return (
    <Card>
      <CardHeader
        title="Role"
        description="What this person is allowed to do."
        action={<Badge tone="brand">{ROLE_LABELS[member.role] ?? member.role}</Badge>}
      />
      <CardBody className="space-y-4">
        {!canManageRoles ? (
          <p className="text-sm text-[var(--text-secondary)]">
            Only an administrator can change a role.
          </p>
        ) : isSelf ? (
          <Alert tone="info">
            You cannot change your own role. Ask another administrator.
          </Alert>
        ) : (
          <form action={submit} className="space-y-3">
            <input type="hidden" name="profileId" value={member.id} />
            {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}
            {state.status === "done" && <Alert tone="success">{state.message}</Alert>}

            <Select name="role" defaultValue={member.role} aria-label="Role">
              {USER_ROLES.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </Select>

            <Button type="submit" loading={pending} variant="outline" className="w-full">
              <ShieldCheck className="size-4" />
              Save role
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function AccessCard({ member, isSelf }: { member: StaffMember; isSelf: boolean }) {
  const [statusState, submitStatus, statusPending] = useActionState(setStaffActiveAction, INITIAL_STAFF_STATE);
  const [pinState, submitPin, pinPending] = useActionState(resetStaffPinAction, INITIAL_STAFF_STATE);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const pinDone = pinState.status === "done" && pinState.revealedPin;

  return (
    <>
      <Card>
        <CardHeader
          title="Access"
          description="Signing in, and the PIN used to do it."
          action={
            member.isActive
              ? <Badge tone="positive">Active</Badge>
              : <Badge tone="critical">Inactive</Badge>
          }
        />
        <CardBody className="space-y-3">
          {statusState.status === "error" && <Alert tone="danger">{statusState.message}</Alert>}
          {statusState.status === "done" && <Alert tone="success">{statusState.message}</Alert>}

          <Button variant="outline" className="w-full" onClick={() => setResetting(true)}>
            <KeyRound className="size-4" />
            {member.hasPin ? "Reset PIN" : "Set PIN"}
          </Button>

          {member.isActive ? (
            <Button
              variant="danger"
              className="w-full"
              disabled={isSelf}
              onClick={() => setConfirming(true)}
            >
              <Power className="size-4" />
              Deactivate
            </Button>
          ) : (
            <form action={submitStatus}>
              <input type="hidden" name="profileId" value={member.id} />
              <input type="hidden" name="active" value="true" />
              <Button type="submit" loading={statusPending} className="w-full">
                <Power className="size-4" />
                Activate
              </Button>
            </form>
          )}

          {isSelf && member.isActive && (
            <p className="text-xs text-[var(--text-muted)]">
              You cannot deactivate your own account.
            </p>
          )}
        </CardBody>
      </Card>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Deactivate ${member.fullName}?`}
        description="They will be signed out and will not be able to sign in again."
      >
        <div className="space-y-4">
          <Alert tone="warning">
            Their account is kept, along with everything they have recorded.
            Their PIN becomes free for someone else, and access can be restored
            at any time.
          </Alert>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <form action={submitStatus} className="flex-1">
              <input type="hidden" name="profileId" value={member.id} />
              <input type="hidden" name="active" value="false" />
              <Button type="submit" variant="danger" loading={statusPending} className="w-full">
                Deactivate
              </Button>
            </form>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={resetting}
        onClose={() => setResetting(false)}
        title={pinDone ? "PIN updated" : `Set a PIN for ${member.fullName}`}
        description={pinDone ? undefined : `Exactly ${PIN_LENGTH} digits, and not already in use.`}
      >
        {pinDone ? (
          <PinReveal
            staffName={pinState.staffName ?? member.fullName}
            pin={pinState.revealedPin!}
            onDone={() => setResetting(false)}
          />
        ) : (
          <form action={submitPin} className="space-y-4">
            <input type="hidden" name="profileId" value={member.id} />
            {pinState.status === "error" && <Alert tone="danger">{pinState.message}</Alert>}
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">New PIN</label>
              <DigitInput length={PIN_LENGTH} name="pin" disabled={pinPending} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">Confirm PIN</label>
              <DigitInput length={PIN_LENGTH} name="confirmPin" disabled={pinPending} />
            </div>
            <Button type="submit" size="lg" loading={pinPending} className="w-full">
              Save PIN
            </Button>
          </form>
        )}
      </Dialog>
    </>
  );
}

function CategoryCard({
  member, categories, canManageRoles, isSelf,
}: {
  member: StaffMember;
  categories: CategoryOption[];
  canManageRoles: boolean;
  isSelf: boolean;
}) {
  const [state, submit, pending] = useActionState(setManagerCategoriesAction, INITIAL_STAFF_STATE);

  return (
    <Card>
      <CardHeader
        title="Product categories"
        description="A manager sees only the categories granted here. Enforced by the database, not by hiding."
      />
      <CardBody>
        {categories.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">
            This organization has no product categories yet.
          </p>
        ) : !canManageRoles || isSelf ? (
          <>
            {isSelf && (
              <Alert tone="info">
                You cannot change your own category access.
              </Alert>
            )}
            <ul className="mt-3 flex flex-wrap gap-2">
              {categories.filter((c) => c.granted).map((c) => (
                <li key={c.id}><Badge tone="brand">{c.name}</Badge></li>
              ))}
              {categories.every((c) => !c.granted) && (
                <li className="text-sm text-[var(--text-secondary)]">
                  No categories granted, so no products are visible to them.
                </li>
              )}
            </ul>
          </>
        ) : (
          <form action={submit} className="space-y-4">
            <input type="hidden" name="profileId" value={member.id} />
            {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}
            {state.status === "done" && <Alert tone="success">{state.message}</Alert>}

            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((category) => (
                <li key={category.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] px-3 text-sm transition-colors hover:bg-[var(--surface-sunken)]">
                    <input
                      type="checkbox"
                      name="categoryIds"
                      value={category.id}
                      defaultChecked={category.granted}
                      className="size-4 accent-[var(--color-brand-700)]"
                    />
                    <span className="truncate">{category.name}</span>
                  </label>
                </li>
              ))}
            </ul>

            <Button type="submit" loading={pending} variant="outline">
              Save category access
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
