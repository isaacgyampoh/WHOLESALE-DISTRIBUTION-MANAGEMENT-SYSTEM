"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { signInWithPinAction, type SignInState } from "@/lib/auth/actions";
import { DigitInput } from "@/components/ui/digit-input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { PIN_LENGTH, attemptsRemainingLabel } from "@/lib/auth/pin";
import { Eye, EyeOff } from "lucide-react";

const INITIAL: SignInState = { status: "idle" };

/**
 * Four digits and nothing else.
 *
 * No name is asked for: the PIN identifies the account on its own. Every
 * failure says the same thing, so the screen cannot be used to learn
 * whose PINs exist - the only extra it gives away is how many tries
 * remain, which the person who owns the PIN needs and a guesser could
 * count for themselves anyway.
 */
export function SignInForm({ nextPath }: { nextPath?: string }) {
  const [state, submit, pending] = useActionState(signInWithPinAction, INITIAL);
  const [reveal, setReveal] = useState(false);
  const [filled, setFilled] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Latches so a re-render while the request is in flight cannot post a
  // second time: a duplicate submission fails on a spent nonce and, worse,
  // spends one of the five tries.
  const sent = useRef(false);
  const errorId = useId();

  const safeNext = nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  const failed = state.status === "error";
  const locked = Boolean(state.cooldownSeconds);

  // A new answer from the server means the next entry may be sent.
  useEffect(() => { sent.current = false; }, [state]);

  return (
    <form action={submit} ref={formRef} className="space-y-6">
      <input type="hidden" name="next" value={safeNext} />

      {failed && (
        <Alert tone={locked ? "warning" : "danger"}>
          <span id={errorId} role="alert">
            {state.message}
            {typeof state.attemptsRemaining === "number" && (
              <span className="mt-1 block text-xs opacity-90">
                {attemptsRemainingLabel(state.attemptsRemaining)}
              </span>
            )}
          </span>
        </Alert>
      )}

      <div>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <label
            htmlFor="pin-0"
            className="text-sm font-medium text-[var(--text-primary)]"
          >
            Enter your {PIN_LENGTH}-digit PIN
          </label>
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-pressed={reveal}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-brand-600/40 focus-visible:outline-none pointer-fine:min-h-0 pointer-fine:py-1"
          >
            {reveal ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
            {reveal ? "Hide" : "Show"}
          </button>
        </div>

        <DigitInput
          // Remounted on every answer so the boxes clear themselves and
          // the next try starts from an empty field.
          key={failed ? `retry-${state.message}-${state.attemptsRemaining ?? ""}` : "pin"}
          idPrefix="pin"
          length={PIN_LENGTH}
          name="pin"
          masked={!reveal}
          autoFocus
          disabled={pending || locked}
          invalid={failed}
          label={`${PIN_LENGTH}-digit PIN`}
          describedBy={failed ? errorId : undefined}
          onChangeValue={(v) => setFilled(v.length === PIN_LENGTH)}
          onComplete={() => {
            // Sent on the fourth digit, so the usual case is four taps
            // and nothing else. The button stays for anyone who paused,
            // corrected a digit, or is working by keyboard.
            if (pending || locked || sent.current) return;
            sent.current = true;
            formRef.current?.requestSubmit();
          }}
        />
      </div>

      <Button
        type="submit"
        size="lg"
        loading={pending}
        disabled={locked || (!filled && !pending)}
        className="w-full"
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-xs leading-relaxed text-[var(--text-muted)]">
        Forgotten your PIN? Ask your administrator to reset it for you.
      </p>
    </form>
  );
}
