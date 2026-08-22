"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";

export interface RecordField {
  name: string;
  label: string;
  type?: "text" | "number" | "decimal" | "date" | "textarea" | "select";
  hint?: string;
  required?: boolean;
  placeholder?: string;
  options?: readonly { value: string; label: string }[];
  /** Half width on anything wider than a phone. */
  half?: boolean;
}

interface RecordState {
  status: "idle" | "error" | "done";
  message?: string;
  values?: Record<string, string>;
  fieldErrors?: Record<string, string>;
}

/**
 * Create-or-edit for the record types that are genuinely just a form:
 * warehouses, suppliers, customers, vans.
 *
 * Declared as fields rather than written out four times, because the
 * behaviour that matters is identical in each case and easy to get
 * subtly wrong per-copy: the submit disables while in flight, a
 * rejected form keeps what was typed, field errors land on their own
 * field, and success is stated rather than implied by the dialog
 * closing.
 *
 * Anything with a rule behind it - a load, a sale, a receipt of goods -
 * has its own form. This is for the ones that do not.
 */
export function RecordForm({
  action,
  fields,
  trigger,
  title,
  description,
  submitLabel,
  /** Present for an edit, absent for a create. */
  record,
  variant = "primary",
  size = "md",
  icon,
  disabled,
}: {
  action: (state: RecordState, formData: FormData) => Promise<RecordState>;
  fields: readonly RecordField[];
  trigger: string;
  title: string;
  description?: string;
  submitLabel?: string;
  record?: Record<string, string | number | null | undefined>;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as RecordState);

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  // A rejected submission wins over the stored record, so nothing the
  // person typed is thrown away by a validation failure.
  const valueFor = (name: string) =>
    state.values?.[name] ?? (record?.[name] === null || record?.[name] === undefined
      ? ""
      : String(record[name]));

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} disabled={disabled}>
        {icon}
        {trigger}
      </Button>

      <Dialog open={open} onClose={close} title={title} description={description}
              className="sm:max-w-lg">
        {state.status === "done" ? (
          <div className="space-y-4">
            <Alert tone="success">{state.message}</Alert>
            <Button className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            {state.status === "error" && state.message && (
              <Alert tone="danger">{state.message}</Alert>
            )}

            {/* Identifiers the action needs. Anything on the record that
                is not a declared field is passed through hidden, which
                is how an action keyed on something other than `id` -
                assigning a driver to a van, say - gets what it needs. */}
            {Object.entries(record ?? {})
              .filter(([name]) => !fields.some((f) => f.name === name))
              .filter(([, value]) => value !== null && value !== undefined)
              .map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={String(value)} />
              ))}

            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((field) => (
                <div key={field.name} className={field.half ? "sm:col-span-1" : "sm:col-span-2"}>
                  <Field
                    label={field.label}
                    htmlFor={field.name}
                    required={field.required}
                    hint={field.hint}
                    error={state.fieldErrors?.[field.name]}
                  >
                    {field.type === "textarea" ? (
                      <Textarea
                        id={field.name} name={field.name} rows={2}
                        defaultValue={valueFor(field.name)}
                        placeholder={field.placeholder}
                      />
                    ) : field.type === "select" ? (
                      <Select
                        id={field.name} name={field.name}
                        required={field.required}
                        defaultValue={valueFor(field.name)}
                      >
                        <option value="">Choose one</option>
                        {(field.options ?? []).map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        id={field.name} name={field.name}
                        required={field.required}
                        placeholder={field.placeholder}
                        type={field.type === "date" ? "date" : "text"}
                        inputMode={
                          field.type === "number" ? "numeric"
                          : field.type === "decimal" ? "decimal"
                          : undefined
                        }
                        className={field.type === "number" || field.type === "decimal" ? "numeric" : undefined}
                        defaultValue={valueFor(field.name)}
                      />
                    )}
                  </Field>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" loading={pending}>
                {submitLabel ?? "Save"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
