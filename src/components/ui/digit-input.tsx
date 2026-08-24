"use client";

import { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Digit boxes that behave like one field.
 *
 * A single input would be simpler, but the boxes tell people how many
 * digits to expect and give a thumb something large to hit. Paste fills
 * every box, backspace steps back, and the whole value is mirrored into
 * a hidden input so the form posts it without JavaScript having to
 * assemble anything.
 *
 * When masked, each filled box shows a dot. The value still lives in the
 * hidden input, so nothing about the entry is guessable from the screen.
 */
export function DigitInput({
  length = 4,
  name = "pin",
  disabled,
  invalid,
  masked = false,
  autoFocus = false,
  label,
  idPrefix,
  describedBy,
  scale = "default",
  onComplete,
  onChangeValue,
}: {
  length?: number;
  name?: string;
  disabled?: boolean;
  invalid?: boolean;
  masked?: boolean;
  autoFocus?: boolean;
  label?: string;
  /** Gives each box a stable id so a <label> can point at the first one. */
  idPrefix?: string;
  describedBy?: string;
  /**
   * "counter" is the sign-in treatment: taller cells, a heavy rule under
   * each, and a shake when the PIN is refused. Everywhere else the
   * compact default sits inside a dialog beside other fields.
   */
  scale?: "default" | "counter";
  onComplete?: (code: string) => void;
  /** Every change, so a caller can enable its own submit button. */
  onChangeValue?: (value: string) => void;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array(length).fill(""));
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const value = digits.join("");

  useEffect(() => {
    onChangeValue?.(value);
    if (value.length === length) onComplete?.(value);
    // Deliberately keyed on the value alone. The callbacks are usually
    // inline arrows, so including them would re-run this on every render
    // of the parent - firing onComplete again for a value already
    // submitted, which costs a real sign-in attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, length]);

  const focus = (i: number) => boxes.current[Math.max(0, Math.min(i, length - 1))]?.focus();

  function setAt(index: number, next: string) {
    setDigits((prev) => {
      const copy = [...prev];
      copy[index] = next;
      return copy;
    });
  }

  function onChange(index: number, raw: string) {
    const only = raw.replace(/\D/g, "");
    if (!only) { setAt(index, ""); return; }

    // A paste, or a keyboard that delivers several characters at once.
    if (only.length > 1) {
      setDigits((prev) => {
        const copy = [...prev];
        for (let i = 0; i < only.length && index + i < length; i++) copy[index + i] = only[i];
        return copy;
      });
      focus(index + only.length);
      return;
    }

    setAt(index, only);
    focus(index + 1);
  }

  function onKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      if (digits[index]) { setAt(index, ""); return; }
      event.preventDefault();
      setAt(index - 1, "");
      focus(index - 1);
      return;
    }
    if (event.key === "ArrowLeft") { event.preventDefault(); focus(index - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); focus(index + 1); }
  }

  return (
    <div>
      <input type="hidden" name={name} value={value} />
      <div
        className={cn(
          "flex justify-between",
          scale === "counter" ? "gap-2.5 sm:gap-3" : "gap-2",
          // One quick shake on a refusal, so a wrong PIN is felt as well
          // as read. Suppressed for anyone who has asked for less motion.
          invalid && scale === "counter" && "motion-safe:animate-[pin-refused_360ms_ease-in-out]",
        )}
        role="group"
        aria-label={label ?? `${length}-digit PIN`}
      >
        {digits.map((digit, i) => (
          <input
            key={i}
            id={idPrefix ? `${idPrefix}-${i}` : undefined}
            ref={(el) => { boxes.current[i] = el; }}
            value={masked && digit ? "•" : digit}
            onChange={(e) => onChange(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onFocus={(e) => e.target.select()}
            disabled={disabled}
            // Off, not one-time-code: this is a standing PIN rather than
            // a texted code, and offering to remember it across four
            // separate boxes produces nonsense.
            autoComplete="off"
            autoFocus={autoFocus && i === 0}
            // Always text. A number input would show a spinner, and a
            // password input cannot render the dot we draw ourselves.
            type="text"
            inputMode="numeric"
            // Not maxLength=1: a paste must be allowed to arrive whole.
            aria-label={`${label ?? "PIN"}, digit ${i + 1} of ${length}`}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(
              "w-full min-w-0 text-center numeric font-semibold text-[var(--text-primary)]",
              "transition-[border-color,box-shadow,background-color] duration-150",
              // A visible ring, not just a border tint: on a bright
              // screen in a warehouse the tint alone is not findable.
              "outline-none disabled:opacity-60",
              scale === "counter"
                ? cn(
                    // A field stamped on a docket: square, ruled heavily
                    // underneath, and the rule is what carries the state.
                    "h-[4.25rem] rounded-t-[6px] rounded-b-none text-[1.75rem]",
                    "border-x border-t border-b-[3px]",
                    // The rule underneath carries the state; the cell
                    // itself stays quiet so four of them read as one
                    // field rather than four buttons.
                    "bg-[var(--surface-raised)]",
                    "focus-visible:bg-brand-50/60 dark:focus-visible:bg-brand-950/30",
                    invalid
                      ? "border-x-critical/25 border-t-critical/25 border-b-critical"
                      : "border-x-[var(--border-subtle)] border-t-[var(--border-subtle)] border-b-[var(--border-strong)] focus-visible:border-x-brand-500/40 focus-visible:border-t-brand-500/40 focus-visible:border-b-brand-700",
                  )
                : cn(
                    "h-16 rounded-[var(--radius-panel)] border text-2xl",
                    "bg-[var(--surface-raised)]",
                    "focus-visible:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-600/40",
                    invalid ? "border-critical" : "border-[var(--border-strong)]",
                  ),
            )}
          />
        ))}
      </div>
    </div>
  );
}
