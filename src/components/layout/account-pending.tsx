import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/states";
import { Button } from "@/components/ui/button";

/**
 * A valid sign-in with no active profile.
 *
 * Reached when someone authenticates through a provider without having
 * been invited. Migration 0017 creates such accounts inactive, so they
 * can prove who they are and reach nothing else. This says so plainly
 * rather than looking like a failure.
 */
export function AccountPending({ email }: { email: string | null }) {
  return (
    <div className="grid min-h-dvh place-items-center px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader
          title="Your account is not active yet"
          description={email ? `Signed in as ${email}` : undefined}
        />
        <CardBody className="space-y-4">
          <Alert tone="info">
            An administrator has to activate this account and give it a role
            before you can use the system.
          </Alert>
          <p className="text-sm text-[var(--text-secondary)]">
            If you were expecting access, ask whoever manages the system to
            activate you. Nothing is visible to you until they do.
          </p>
          <form action="/auth/sign-out" method="post">
            <Button type="submit" variant="outline" className="w-full">
              Sign out
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
