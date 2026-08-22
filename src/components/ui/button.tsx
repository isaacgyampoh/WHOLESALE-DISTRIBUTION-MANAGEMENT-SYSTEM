import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "touch";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 disabled:bg-brand-700/50",
  secondary:
    "bg-[var(--surface-sunken)] text-[var(--text-primary)] hover:bg-ink-200 dark:hover:bg-ink-800 border border-[var(--border-subtle)]",
  outline:
    "border border-[var(--border-strong)] text-[var(--text-primary)] hover:bg-[var(--surface-sunken)]",
  ghost: "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]",
  danger: "bg-critical text-white hover:brightness-95 active:brightness-90",
};

const SIZES: Record<Size, string> = {
  // Finger-sized on touch, compact where there is a real pointer.
  // 44px under a finger, compact where there is a real pointer. A small
  // button is still a button somebody has to hit: table row actions -
  // approve, receive, dispatch - are mostly used on a phone, and 36px
  // was below the minimum on every one of them.
  sm: "h-11 px-3 text-xs gap-1.5 pointer-fine:h-8",
  md: "h-11 px-4 text-sm gap-2 pointer-fine:h-9.5",
  lg: "h-11 px-5 text-sm gap-2",
  // Driver PWA: thumb-sized targets, used one-handed in a van.
  touch: "h-14 px-6 text-base gap-2.5 w-full",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-[var(--radius-panel)] font-medium",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
