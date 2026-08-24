import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";
import { Alert } from "@/components/ui/states";
import { ClearOfflineCaches } from "@/components/pwa/clear-cache";
import { BRAND } from "@/lib/brand";
import { PackageCheck, Route, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Sign in",
  description: `${BRAND.name} — Wholesale Distribution Management System`,
};

const CALLBACK_ERRORS: Record<string, string> = {
  missing_code: "That sign-in link was incomplete. Please try again.",
  exchange_failed: "That sign-in could not be completed. Please try again.",
};

/** Stated plainly, without stock photography or a marketing voice. */
const ASSURANCES = [
  {
    icon: PackageCheck,
    title: "Every unit accounted for",
    body: "Warehouse to van, van to customer, reconciled at the end of each round.",
  },
  {
    icon: Route,
    title: "Every cedi traceable",
    body: "Cash and credit tie back to the person, van and transaction that moved it.",
  },
  {
    icon: ShieldCheck,
    title: "Access scoped by role",
    body: "Records you are not responsible for are not shown to you.",
  },
];

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

      <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/*
          The form column. Vertically centred where there is room, and
          allowed to scroll from the top where there is not - which is
          what happens on a short phone once the keyboard opens.
        */}
        <div className="flex min-h-dvh flex-col justify-center px-6 py-10 sm:px-10 lg:px-14">
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-9 flex items-center gap-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-700 text-sm font-bold tracking-tight text-white">
                {BRAND.initials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-[var(--text-primary)]">
                  {BRAND.name}
                </p>
                <p className="truncate text-xs text-[var(--text-secondary)]">
                  Wholesale Distribution Management System
                </p>
              </div>
            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-[1.75rem]">
              Welcome back
            </h1>
            <p className="mt-2 mb-7 text-sm leading-relaxed text-[var(--text-secondary)]">
              Sign in with the username and PIN issued to you.
            </p>

            {callbackError && (
              <div className="mb-5">
                <Alert tone="danger">{callbackError}</Alert>
              </div>
            )}

            <SignInForm nextPath={next} />
          </div>

          <p className="mx-auto mt-10 w-full max-w-sm text-xs text-[var(--text-muted)]">
            © {new Date().getFullYear()} {BRAND.name}
          </p>
        </div>

        {/*
          Context panel. Hidden below lg, where the form should have the
          whole screen rather than share it with reassurance.
        */}
        <div className="relative hidden flex-col justify-center bg-ink-900 p-14 lg:flex">
          <div className="max-w-md">
            <p className="text-[1.35rem] leading-snug font-medium text-ink-100">
              Every unit of stock and every cedi is traceable to the person,
              van and transaction that moved it.
            </p>

            <ul className="mt-11 space-y-7">
              {ASSURANCES.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4">
                  <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 text-ink-100">
                    <Icon className="size-4" aria-hidden />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-ink-100">{title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-400">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
