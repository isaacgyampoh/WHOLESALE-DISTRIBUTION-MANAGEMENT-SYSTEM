"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";

interface ActionState {
  status: "idle" | "error" | "done";
  message?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * A button that performs one server action behind a confirmation.
 *
 * Approving a return, dispatching a load, deactivating a warehouse: all
 * of them move stock or money, none of them should happen on a stray
 * tap, and every one of them wants to say what it is about to do before
 * it does it. Written once so they all behave the same way - including
 * the part that matters most, which is that the button is disabled while
 * the request is in flight and cannot be pressed twice.
 */
export function ActionButton({
  action,
  label,
  title,
  description,
  confirmLabel,
  warning,
  /** When set, the action requires a written reason and this is its prompt. */
  reasonLabel,
  reasonHint,
  fields = {},
  variant = "primary",
  size = "sm",
  icon,
  disabled,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  title: string;
  description?: string;
  confirmLabel?: string;
  warning?: { title: string; body: string };
  reasonLabel?: string;
  reasonHint?: string;
  /** Hidden values the action needs, such as the row's id. */
  fields?: Record<string, string>;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as ActionState);

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} disabled={disabled}>
        {icon}
        {label}
      </Button>

      <Dialog open={open} onClose={close} title={title} description={description}>
        {state.status === "done" ? (
          <div className="space-y-4">
            <Alert tone="success">{state.message}</Alert>
            <Button className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            {state.status === "error" && state.message && !state.fieldErrors && (
              <Alert tone="danger">{state.message}</Alert>
            )}
            {warning && (
              <Alert tone="warning" title={warning.title}>{warning.body}</Alert>
            )}

            {Object.entries(fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}

            {reasonLabel && (
              <Field
                label={reasonLabel}
                htmlFor="actionReason"
                required
                hint={reasonHint}
                error={state.fieldErrors?.reason ?? state.fieldErrors?.note}
              >
                <Textarea id="actionReason" name="reason" rows={3} required />
              </Field>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" variant={variant} loading={pending}>
                {confirmLabel ?? label}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
