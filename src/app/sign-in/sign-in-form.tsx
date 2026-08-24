"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { signInWithPinAction, type SignInState } from "@/lib/auth/actions";
import { DigitInput } from "@/components/ui/digit-input";
import { Button } from "@/components/ui/button";
import {
  PIN_LENGTH, MAX_FAILED_ATTEMPTS, COOLDOWN_MINUTES, attemptsRemainingLabel,
} from "@/lib/auth/pin";
import { Eye, EyeOff, Lock, TriangleAlert } from "lucide-react";

const INITIAL: SignInState = { status: "idle" };

/**
 * Four digits and one button.
 *
 * The refusal is drawn between the fields and the button rather than
 * floated above them: it belongs to the fields it is about, and on a
 * phone a banner that appears above the form pushes those fields under
 * the keypad at the exact moment somebody is trying to correct them.
 */
export function SignInForm({ nextPath }: { nextPath?: string }) {
  const [state, submit, pending] = useActionState(signInWithPinAction, INITIAL);
  const [reveal, setReveal] = useState(false);
  const [filled, setFilled] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Latches so a re-render while the request is in flight cannot post a
  // second time: a duplicate submission fails on a spent nonce and,
  // worse, spends one of the five tries.
  const sent = useRef(false);
  const errorId = useId();

  const safeNext = nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  const failed = state.status === "error";
  const locked = Boolean(state.cooldownSeconds);

  // A new answer from the server means the next entry may be sent.
  useEffect(() => { sent.current = false; }, [state]);

  return (
    <form action={submit} ref={formRef}>
      <input type="hidden" name="next" value={safeNext} />

      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <label htmlFor="pin-0" className="text-sm font-medium text-[var(--text-primary)]">
          Enter your {PIN_LENGTH}-digit PIN
        </label>
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          aria-pressed={reveal}
          className="-mr-2 flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-brand-600/40 focus-visible:outline-none pointer-fine:min-h-0 pointer-fine:py-1"
        >
          {reveal ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
          {reveal ? "Hide" : "Show"}
        </button>
      </div>

      <DigitInput
        // Remounted on every answer so the fields clear themselves and
        // the next try starts from empty.
        key={failed ? `retry-${state.message}-${state.attemptsRemaining ?? ""}` : "pin"}
        idPrefix="pin"
        scale="counter"
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
          // Sent on the last digit, so the usual case is four taps and
          // nothing else. The button stays for anyone who paused,
          // corrected a digit, or is working by keyboard.
          if (pending || locked || sent.current) return;
          sent.current = true;
          formRef.current?.requestSubmit();
        }}
      />

      {failed && (
        <div
          id={errorId}
          role="alert"
          className={[
            "mt-4 flex items-start gap-2.5 rounded-[8px] px-3.5 py-3",
            locked
              ? "bg-caution-soft text-caution dark:bg-caution/10"
              : "bg-critical-soft text-critical dark:bg-critical/10",
          ].join(" ")}
        >
          {locked
            ? <Lock className="mt-px size-4 shrink-0" aria-hidden />
            : <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />}
          <div className="min-w-0 text-[0.8125rem] leading-snug">
            <p className="font-medium">{state.message}</p>
            {typeof state.attemptsRemaining === "number" && (
              <p className="mt-0.5 opacity-80">
                {attemptsRemainingLabel(state.attemptsRemaining)}
              </p>
            )}
          </div>
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        loading={pending}
        disabled={locked || (!filled && !pending)}
        className="mt-5 w-full"
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      {/*
        Said before it happens, not after. Somebody who knows the rule
        stops and thinks on their third try; somebody who meets it for
        the first time on the fifth has already been locked out.
      */}
      <p className="mt-5 border-t border-[var(--border-subtle)] pt-4 text-xs leading-relaxed text-[var(--text-muted)]">
        After {MAX_FAILED_ATTEMPTS} incorrect attempts, sign-in is locked for{" "}
        {COOLDOWN_MINUTES} minutes. Forgotten your PIN? Ask your administrator
        to reset it.
      </p>
    </form>
  );
}
