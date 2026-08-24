"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { setInitialPinAction, type ChangePinState } from "@/lib/auth/actions";
import { DigitInput } from "@/components/ui/digit-input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { PIN_LENGTH } from "@/lib/auth/pin";

const INITIAL: ChangePinState = { status: "idle" };

/**
 * New PIN, twice. The current one is not asked for - it was issued by
 * somebody else, so knowing it proves nothing.
 */
export function SetPinForm() {
  const [state, submit, pending] = useActionState(setInitialPinAction, INITIAL);
  const router = useRouter();

  const failed = state.status === "error";
  // Derived, not stored: the action result already says it happened.
  const done = state.status === "done";

  // The shell decides where this person belongs from their role, so this
  // asks the server for the page rather than choosing one here.
  useEffect(() => {
    if (done) {
      router.replace("/");
      router.refresh();
    }
  }, [done, router]);

  return (
    <form action={submit} className="space-y-6">
      {failed && (
        <Alert tone="danger">
          <span role="alert">{state.message}</span>
        </Alert>
      )}

      <div>
        <label
          htmlFor="new-pin-0"
          className="mb-3 block text-sm font-medium text-[var(--text-primary)]"
        >
          Choose a new {PIN_LENGTH}-digit PIN
        </label>
        <DigitInput
          key={failed ? `retry-${state.message}` : "new"}
          idPrefix="new-pin"
          length={PIN_LENGTH}
          name="newPin"
          masked
          autoFocus
          disabled={pending || done}
          invalid={failed}
          label={`New ${PIN_LENGTH}-digit PIN`}
        />
      </div>

      <div>
        <label
          htmlFor="confirm-pin-0"
          className="mb-3 block text-sm font-medium text-[var(--text-primary)]"
        >
          Enter it again
        </label>
        <DigitInput
          key={failed ? `retry-confirm-${state.message}` : "confirm"}
          idPrefix="confirm-pin"
          length={PIN_LENGTH}
          name="confirmPin"
          masked
          disabled={pending || done}
          invalid={failed}
          label={`Confirm your new ${PIN_LENGTH}-digit PIN`}
        />
      </div>

      <Button type="submit" size="lg" loading={pending || done} className="w-full">
        {done ? "Signing you in…" : pending ? "Saving…" : "Set my PIN"}
      </Button>

      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        Avoid a birthday, a repeated digit, or anything written on your
        badge. You will use this PIN every time you sign in.
      </p>
    </form>
  );
}
