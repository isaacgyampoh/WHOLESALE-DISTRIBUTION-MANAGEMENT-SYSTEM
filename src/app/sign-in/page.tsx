import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";
import { Alert } from "@/components/ui/states";
import { BrandMark } from "@/components/layout/brand-mark";
import { ClearOfflineCaches } from "@/components/pwa/clear-cache";

export const metadata: Metadata = { title: "Sign in" };

const CALLBACK_ERRORS: Record<string, string> = {
  missing_code: "That sign-in link was incomplete. Please try again.",
  exchange_failed: "That sign-in could not be completed. Please try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const callbackError = error ? CALLBACK_ERRORS[error] : undefined;

  return (
    <>
      <ClearOfflineCaches />
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <BrandMark className="mb-8" />
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            Sign in
          </h1>
          <p className="mt-1.5 mb-8 text-sm text-[var(--text-secondary)]">
            Sign in with the PIN issued to you.
          </p>
          {callbackError && (
            <div className="mb-4">
              <Alert tone="danger">{callbackError}</Alert>
            </div>
          )}
          <SignInForm nextPath={next} />
        </div>
      </div>

      {/* Context panel: states what the system is for, without stock art. */}
      <div className="hidden flex-col justify-between bg-ink-900 p-12 lg:flex">
        <div />
        <div className="max-w-md">
          <p className="text-lg leading-relaxed font-medium text-ink-100">
            Every unit of stock and every cedi is traceable to the person,
            van and transaction that moved it.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-ink-400">
            Warehouse to van, van to customer, cash and credit back to the
            books, reconciled at the end of every round.
          </p>
        </div>
        <p className="text-xs text-ink-500">
          Access is scoped by role. Records you are not responsible for are
          not shown.
        </p>
      </div>
    </div>
    </>
  );
}
