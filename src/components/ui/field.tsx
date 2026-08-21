import * as React from "react";
import { cn } from "@/lib/utils/cn";

const CONTROL =
  "w-full rounded-[var(--radius-panel)] border border-[var(--border-strong)] " +
  "bg-[var(--surface-raised)] px-3 text-sm text-[var(--text-primary)] " +
  "placeholder:text-[var(--text-muted)] transition-colors " +
  "focus:border-brand-600 disabled:cursor-not-allowed disabled:opacity-60 " +
  "aria-[invalid=true]:border-critical";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(CONTROL, "h-9.5", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(CONTROL, "h-9.5", className)} {...props}>
    {children}
  </select>
));
Select.displayName = "Select";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(CONTROL, "min-h-20 py-2", className)} {...props} />
));
Textarea.displayName = "Textarea";

export function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label
      className={cn("text-sm font-medium text-[var(--text-primary)]", className)}
      {...props}
    >
      {children}
      {required && <span className="ml-0.5 text-critical">*</span>}
    </label>
  );
}

/** Label, control and message as one unit, so forms stay consistent. */
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-critical">{error}</p>
      ) : hint ? (
        <p className="text-xs text-[var(--text-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}
