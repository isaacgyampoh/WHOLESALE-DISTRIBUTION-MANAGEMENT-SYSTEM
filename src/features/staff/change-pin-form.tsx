"use client";

import { useActionState } from "react";
import { changeOwnPinAction, type ChangePinState } from "@/lib/auth/actions";
import { DigitInput } from "@/components/ui/digit-input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { PIN_LENGTH } from "@/lib/auth/pin";

const INITIAL: ChangePinState = { status: "idle" };

export function ChangePinForm() {
  const [state, submit, pending] = useActionState(changeOwnPinAction, INITIAL);

  if (state.status === "done") {
    return <Alert tone="success">{state.message}</Alert>;
  }

  return (
    <form action={submit} className="space-y-4">
      {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}

      <Group label="Current PIN">
        <DigitInput length={PIN_LENGTH} name="currentPin" masked disabled={pending} />
      </Group>
      <Group label={`New ${PIN_LENGTH}-digit PIN`}>
        <DigitInput length={PIN_LENGTH} name="newPin" masked disabled={pending} />
      </Group>
      <Group label="Confirm new PIN">
        <DigitInput length={PIN_LENGTH} name="confirmPin" masked disabled={pending} />
      </Group>

      <Button type="submit" size="lg" loading={pending} className="w-full">
        Change PIN
      </Button>
    </form>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">{label}</label>
      {children}
    </div>
  );
}
