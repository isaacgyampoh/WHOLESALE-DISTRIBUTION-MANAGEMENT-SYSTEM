import { Alert } from "@/components/ui/states";
import { Button } from "@/components/ui/button";

/**
 * The one moment a PIN is visible. It is not stored in a form that can
 * be read back, so if it is not written down now it must be reset.
 */
export function PinReveal({
  staffName,
  pin,
  onDone,
}: {
  staffName: string;
  pin: string;
  onDone: () => void;
}) {
  return (
    <div className="space-y-4">
      <Alert tone="success" title={`${staffName} can now sign in`}>
        Give them this PIN now. It cannot be read back afterwards; if it is
        lost, set a new one.
      </Alert>
      <p className="numeric rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] py-6 text-center text-4xl font-semibold tracking-[0.35em] text-[var(--text-primary)]">
        {pin}
      </p>
      <Button variant="outline" className="w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
