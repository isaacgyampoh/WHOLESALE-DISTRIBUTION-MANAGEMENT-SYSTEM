import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/states";

/**
 * Shown when the app is running without Supabase credentials. This is a
 * configuration state, not an error: a 500 would suggest something broke.
 */
export function SetupRequired() {
  return (
    <div className="grid min-h-dvh place-items-center px-6 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader
          title="Connect a Supabase project"
          description="The application cannot reach a database yet."
        />
        <CardBody className="space-y-4">
          <Alert tone="info" title="Two values are missing">
            <code className="text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
          </Alert>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--text-secondary)]">
            <li>
              Copy <code className="text-xs">.env.example</code> to{" "}
              <code className="text-xs">.env.local</code>.
            </li>
            <li>
              Fill in the project URL and anon key from{" "}
              <span className="text-[var(--text-primary)]">
                Project Settings &rarr; API
              </span>{" "}
              in your Supabase project.
            </li>
            <li>
              Apply the migrations in{" "}
              <code className="text-xs">supabase/migrations</code> in filename
              order, one file per run.
            </li>
            <li>Restart the development server.</li>
          </ol>
          <p className="text-xs text-[var(--text-muted)]">
            The service role key is only needed for privileged server
            operations. Never expose it to the browser.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
