"use client";

import { useEffect } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";

/**
 * Route-level boundary. Next passes a digest rather than the original
 * message in production, which is what we want: internals stay in the
 * server log.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] route error", error);
  }, [error]);

  return (
    <Card>
      <ErrorState
        title="This page could not be loaded"
        message="The problem has been logged. Try again, and if it continues, contact your administrator."
        onRetry={reset}
      />
    </Card>
  );
}
