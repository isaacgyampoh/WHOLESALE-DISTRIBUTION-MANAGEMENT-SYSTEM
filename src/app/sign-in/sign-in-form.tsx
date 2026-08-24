"use client";

import { useActionState, useId, useRef, useState } from "react";
import { signInWithPinAction, type SignInState } from "@/lib/auth/actions";
import { DigitInput } from "@/components/ui/digit-input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { PIN_LENGTH } from "@/lib/auth/pin";
import { Eye, EyeOff } from "lucide-react";

const INITIAL: SignInState = { status: "idle" };

/**
 * Username, then four digits.
 *
 * Every failure says the same thing - an unknown username and a wrong
 * PIN are indistinguishable - so the screen cannot be used to find out
 * who works here.
 */
export function SignInForm({ nextPath }: { nextPath?: string }) {
  const [state, submit, pending] = useActionState(signInWithPinAction, INITIAL);
  const [reveal, setReveal] = useState(false);
  const [username, setUsername] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const safeNext = nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  const failed = state.status === "error";

  return (
    <form action={submit} ref={formRef} className="space-y-5">
      <input type="hidden" name="next" value={safeNext} />

      {failed && (
        <Alert tone="danger">
          {/* role=alert so it is announced, not just drawn. */}
          <span id={errorId} role="alert">{state.message}</span>
        </Alert>
      )}

      <div>
        <label
          htmlFor="username"
          className="mb-2 block text-sm font-medium text-[var(--text-primary)]"
        >
          Username
        </label>
        <input
          id="username"
          name="username"
          ref={usernameRef}
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter your username"
          required
          autoFocus
          disabled={pending}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          aria-invalid={failed || undefined}
          aria-describedby={failed ? errorId : undefined}
          className={[
            "h-12 w-full rounded-[var(--radius-panel)] border px-3.5",
            "bg-[var(--surface-raised)] text-base text-[var(--text-primary)]",
            "placeholder:text-[var(--text-muted)] transition-colors",
            "outline-none focus-visible:border-brand-600",
            "focus-visible:ring-2 focus-visible:ring-brand-600/40",
            "disabled:opacity-60",
            failed ? "border-critical" : "border-[var(--border-strong)]",
          ].join(" ")}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label
            htmlFor="pin-0"
            className="text-sm font-medium text-[var(--text-primary)]"
          >
            {PIN_LENGTH}-digit PIN
          </label>
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-pressed={reveal}
            className="flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-brand-600/40 focus-visible:outline-none pointer-fine:min-h-0 pointer-fine:py-1"
          >
            {reveal ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
            {reveal ? "Hide PIN" : "Show PIN"}
          </button>
        </div>

        <DigitInput
          key={failed ? `retry-${state.message}` : "pin"}
          idPrefix="pin"
          length={PIN_LENGTH}
          name="pin"
          masked={!reveal}
          disabled={pending}
          invalid={failed}
          label={`${PIN_LENGTH}-digit PIN`}
          describedBy={failed ? errorId : undefined}
          onComplete={() => {
            if (pending) return;
            // Submitted for them once the last digit lands. If they
            // filled the PIN first, sending it would be a certain
            // failure that also clears what they typed, so the cursor
            // goes to the field they still have to fill instead - which
            // is the only thing on screen that would explain the wait.
            if (username.trim()) formRef.current?.requestSubmit();
            else usernameRef.current?.focus();
          }}
        />
      </div>

      <Button type="submit" size="lg" loading={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-xs leading-relaxed text-[var(--text-muted)]">
        Forgotten your PIN? Ask your administrator to reset it for you.
      </p>
    </form>
  );
}
