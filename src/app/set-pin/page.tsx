import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/auth/session";
import { BrandMark } from "@/components/layout/brand-mark";
import { SetPinForm } from "./set-pin-form";
import { BRAND } from "@/lib/brand";
import { ShieldCheck } from "lucide-react";

export const metadata: Metadata = { title: "Set your PIN" };
export const dynamic = "force-dynamic";

/**
 * The one screen a provisional account can reach.
 *
 * Deliberately outside the application shell: there is no sidebar and no
 * navigation, because there is nowhere else to go until this is done.
 */
export default async function SetPinPage() {
  const session = await getSessionState();

  if (session.status === "anonymous") redirect("/sign-in");
  if (session.status === "pending") redirect("/");
  // Nothing to do here once a PIN has been chosen. Changing it again
  // goes through the account page, which asks for the current one.
  if (!session.mustChangePin) redirect("/");

  const firstName = session.user.fullName.trim().split(/\s+/)[0];

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--surface-sunken)] px-4 py-10">
      <div className="w-full max-w-md">
        <BrandMark className="mb-8 justify-center" />

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:p-8">
          <div className="mb-6 flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <ShieldCheck className="size-5" aria-hidden />
          </div>

          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            {firstName ? `Welcome, ${firstName}` : "Welcome"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
            The PIN you signed in with was issued to you, so somebody else
            knows it. Choose one only you know to finish setting up your
            account.
          </p>

          <div className="mt-6">
            <SetPinForm />
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
          {BRAND.name} · Keep your PIN to yourself. Nobody will ask you for it.
        </p>
      </div>
    </main>
  );
}
