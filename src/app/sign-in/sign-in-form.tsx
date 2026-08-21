"use client";

import { useActionState, useRef, useState } from "react";
import { signInWithPinAction, type SignInState } from "@/lib/auth/actions";
import { DigitInput } from "@/components/ui/digit-input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { PIN_LENGTH } from "@/lib/auth/pin";
import { Eye, EyeOff } from "lucide-react";

const INITIAL: SignInState = { status: "idle" };

/**
 * Four digits and nothing else.
 *
 * Every failure says the same thing, so the screen cannot be used to
 * learn whose PINs exist.
 */
export function SignInForm({ nextPath }: { nextPath?: string }) {
  const [state, submit, pending] = useActionState(signInWithPinAction, INITIAL);
  const [reveal, setReveal] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const safeNext = nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  const failed = state.status === "error";

  return (
    <form action={submit} ref={formRef} className="space-y-6">
      <input type="hidden" name="next" value={safeNext} />

      {failed && <Alert tone="danger">{state.message}</Alert>}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <label className="text-sm font-medium text-[var(--text-primary)]">
            Enter your {PIN_LENGTH}-digit PIN
          </label>
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? "Hide PIN" : "Show PIN"}
            className="flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] pointer-fine:min-h-0 pointer-fine:py-1"
          >
            {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {reveal ? "Hide" : "Show"}
          </button>
        </div>

        <DigitInput
          key={failed ? `retry-${state.message}` : "pin"}
          length={PIN_LENGTH}
          name="pin"
          masked={!reveal}
          autoFocus
          disabled={pending}
          invalid={failed}
          label={`${PIN_LENGTH}-digit PIN`}
          onComplete={() => {
            if (!pending) formRef.current?.requestSubmit();
          }}
        />
      </div>

      <Button type="submit" size="lg" loading={pending} className="w-full">
        Sign in
      </Button>

      <p className="text-center text-xs text-[var(--text-muted)]">
        Forgotten your PIN? Please contact your administrator to reset it.
      </p>
    </form>
  );
}
