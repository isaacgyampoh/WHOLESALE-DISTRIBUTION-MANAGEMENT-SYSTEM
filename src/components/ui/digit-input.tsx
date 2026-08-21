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
  onComplete,
}: {
  length?: number;
  name?: string;
  disabled?: boolean;
  invalid?: boolean;
  masked?: boolean;
  autoFocus?: boolean;
  label?: string;
  onComplete?: (code: string) => void;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array(length).fill(""));
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const value = digits.join("");

  useEffect(() => {
    if (value.length === length) onComplete?.(value);
  }, [value, length, onComplete]);

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
        className="flex justify-between gap-2"
        role="group"
        aria-label={label ?? `${length}-digit PIN`}
      >
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { boxes.current[i] = el; }}
            value={masked && digit ? "•" : digit}
            onChange={(e) => onChange(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onFocus={(e) => e.target.select()}
            disabled={disabled}
            // One-time-code lets iOS and Android offer the SMS directly.
            autoComplete="off"
            autoFocus={autoFocus && i === 0}
            type={masked ? "text" : "text"}
            inputMode="numeric"
            // Not maxLength=1: a paste must be allowed to arrive whole.
            aria-label={`Digit ${i + 1}`}
            aria-invalid={invalid || undefined}
            className={cn(
              "h-16 w-full min-w-0 rounded-[var(--radius-panel)] border text-center",
              "numeric text-2xl font-semibold text-[var(--text-primary)]",
              "bg-[var(--surface-raised)] transition-colors",
              "focus:border-brand-600 disabled:opacity-60",
              invalid ? "border-critical" : "border-[var(--border-strong)]",
            )}
          />
        ))}
      </div>
    </div>
  );
}
