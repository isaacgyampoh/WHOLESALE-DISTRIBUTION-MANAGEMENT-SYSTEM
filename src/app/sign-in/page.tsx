import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";
import { Alert } from "@/components/ui/states";
import { ClearOfflineCaches } from "@/components/pwa/clear-cache";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Sign in",
  description: `${BRAND.name} — Wholesale Distribution Management System`,
};

const CALLBACK_ERRORS: Record<string, string> = {
  missing_code: "That sign-in link was incomplete. Please try again.",
  exchange_failed: "That sign-in could not be completed. Please try again.",
};

/**
 * One card, one field.
 *
 * The screen is entered on a phone in a yard, often one-handed and in
 * sunlight, so everything that is not the PIN has been taken off it. No
 * marketing panel, no illustration, no second column: those were there
 * when the page had two fields and a wait, and they only push the boxes
 * down the screen now.
 */
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

      <main className="relative flex min-h-dvh flex-col bg-[var(--surface-sunken)]">
        {/*
          A single wash of brand colour at the top, behind the card. Not a
          gradient across the page: it gives the card something to sit
          against and costs nothing to read past.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-brand-700/10 to-transparent"
        />

        {/*
          Centred where there is room; scrolls from the top where there is
          not, which is what happens on a short phone with the keypad up.
          justify-center would hide the boxes above the fold there.
        */}
        <div className="relative flex flex-1 items-center justify-center px-5 py-10 sm:px-6">
          <div className="w-full max-w-[25rem]">
            <div className="mb-8 flex flex-col items-center text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-brand-700 text-lg font-bold tracking-tight text-white shadow-sm">
                {BRAND.initials}
              </div>
              <h1 className="mt-4 text-xl font-semibold tracking-tight text-[var(--text-primary)]">
                {BRAND.name}
              </h1>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Wholesale Distribution Management System
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:p-7">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Welcome back
              </h2>
              <p className="mt-1 mb-6 text-sm text-[var(--text-secondary)]">
                Sign in with the PIN issued to you.
              </p>

              {callbackError && (
                <div className="mb-5">
                  <Alert tone="danger">{callbackError}</Alert>
                </div>
              )}

              <SignInForm nextPath={next} />
            </div>

            <p className="mt-7 text-center text-xs text-[var(--text-muted)]">
              © {new Date().getFullYear()} {BRAND.name}
              <span className="mx-1.5" aria-hidden>·</span>
              Access is scoped by role
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
