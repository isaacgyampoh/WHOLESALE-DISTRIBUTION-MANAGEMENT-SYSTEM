import { Alert } from "@/components/ui/states";
import { Button } from "@/components/ui/button";

/**
 * The one moment a PIN is visible. It is not stored in a form that can
 * be read back, so if it is not written down now it must be reset.
 */
export function PinReveal({
  staffName,
  username,
  pin,
  onDone,
}: {
  staffName: string;
  username?: string;
  pin: string;
  onDone: () => void;
}) {
  return (
    <div className="space-y-4">
      <Alert tone="success" title={`${staffName} can now sign in`}>
        Give them these now. The PIN cannot be read back afterwards; if it
        is lost, set a new one. They will be asked to choose their own PIN
        the first time they sign in, and this one stops working then.
      </Alert>

      <div className="space-y-3 rounded-[var(--radius-panel)] bg-[var(--surface-sunken)] p-4">
        {username && (
          <div>
            <p className="text-xs font-medium text-[var(--text-muted)]">Username</p>
            <p className="mt-0.5 text-lg font-semibold break-all text-[var(--text-primary)]">
              {username}
            </p>
          </div>
        )}
        <div>
          <p className="text-xs font-medium text-[var(--text-muted)]">PIN</p>
          <p className="numeric mt-0.5 text-4xl font-semibold tracking-[0.35em] text-[var(--text-primary)]">
            {pin}
          </p>
        </div>
      </div>
      <Button variant="outline" className="w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
