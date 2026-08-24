import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";
import { Alert } from "@/components/ui/states";
import { ClearOfflineCaches } from "@/components/pwa/clear-cache";
import { BRAND } from "@/lib/brand";
import { Boxes, Receipt, Truck } from "lucide-react";

export const metadata: Metadata = {
  title: "Sign in",
  description: `${BRAND.name} — Wholesale Distribution Management System`,
};

const CALLBACK_ERRORS: Record<string, string> = {
  missing_code: "That sign-in link was incomplete. Please try again.",
  exchange_failed: "That sign-in could not be completed. Please try again.",
};

/**
 * A photograph of this business at work, if one has been supplied.
 *
 * Checked rather than assumed. The panel is composed to stand on its own
 * - dark ground, gold rule, the company's name - so the absence of the
 * file is a quieter panel and never a broken image. See
 * public/images/README.md.
 */
const PHOTO = "/images/warehouse.jpg";
// Decided in next.config.ts, at build time. `public/` is not on the
// filesystem the server functions run against, so asking here would
// answer "no photograph" however many are deployed.
const hasPhoto = process.env.NEXT_PUBLIC_SIGNIN_PHOTO === "1";

/**
 * What this system actually does, in the words used inside it.
 *
 * Three, not eight: this is a sign-in screen and the list is context,
 * not a feature grid. Each one names a section of the application the
 * person is about to open.
 */
const CAPABILITIES = [
  { icon: Boxes, label: "Inventory control", note: "Stock, batches and movement" },
  { icon: Receipt, label: "Sales and credit", note: "Invoices, receipts and what is owed" },
  { icon: Truck, label: "Distribution", note: "Vans, loads and supplier orders" },
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

      {/*
        Two panels that each fill their half, rather than a card floating
        on a background. The business is on the left and the way in is on
        the right, and neither is decoration for the other.

        Below lg the same two parts stack, but the band is cut back hard
        to a mark and one line. The full version costs about 500px, which
        on an 844px phone puts the PIN below the fold before the keypad
        has even opened - and the PIN is what the person came for. The
        context it drops moves under the form, which is also the honest
        order: brand, way in, then what the place does.
      */}
      <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[1.15fr_1fr] xl:grid-cols-[1.25fr_1fr]">
        {/* ============ the business ============ */}
        <section className="relative isolate overflow-hidden bg-ink-950 px-6 py-8 sm:px-10 lg:flex lg:flex-col lg:justify-between lg:py-14 xl:px-16">
          {hasPhoto && (
            <>
              {/*
                Plain <img> with fetchPriority, not next/image: this is a
                single fixed asset on a page that must paint fast on a
                phone in a yard, and the optimizer's round trip buys
                nothing for one image that is already sized correctly.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={PHOTO}
                alt=""
                aria-hidden
                fetchPriority="high"
                decoding="async"
                className="absolute inset-0 -z-10 size-full object-cover object-center"
              />
              {/*
                The scrim. Heavier at the left, where the words are, and
                clearing towards the right so the photograph is still a
                photograph rather than a texture.
              */}
              <div
                aria-hidden
                className="absolute inset-0 -z-10 bg-gradient-to-r from-ink-950 via-ink-950/85 to-ink-950/45"
              />
            </>
          )}

          <div className="flex items-center gap-3.5">
            <div className="grid size-12 shrink-0 place-items-center rounded-[10px] bg-brand-600 text-base font-bold tracking-tight text-white">
              {BRAND.initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold tracking-tight text-white">
                {BRAND.name}
              </p>
              <p className="truncate text-[0.8125rem] text-ink-400">
                Wholesale Distribution Management System
              </p>
            </div>
          </div>

          <div className="mt-7 max-w-xl lg:mt-0">
            {/* A gold rule rather than a gold box: the company signs the
                panel, it does not decorate it. */}
            <div className="mb-4 h-px w-12 bg-gold-400 lg:mb-5" aria-hidden />

            <h2 className="text-[1.5rem] leading-[1.15] font-semibold tracking-tight text-white sm:text-[2rem] lg:text-[2.5rem]">
              Smart inventory.
              <br />
              Stronger business.
            </h2>

            {/* Everything below is context, and context waits its turn on
                a phone: it reappears under the form. */}
            <p className="mt-4 hidden max-w-md text-[0.9375rem] leading-relaxed text-ink-300 lg:block">
              Stock, sales, suppliers and every van on the road, in one
              system that agrees with itself.
            </p>

            <ul className="mt-11 hidden space-y-4 lg:block">
              {CAPABILITIES.map(({ icon: Icon, label, note }) => (
                <li key={label} className="flex items-start gap-3.5">
                  <Icon className="mt-0.5 size-[1.125rem] shrink-0 text-gold-400" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">{label}</p>
                    <p className="text-[0.8125rem] text-ink-400">{note}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-10 hidden text-xs text-ink-500 lg:mt-0 lg:block">
            © {new Date().getFullYear()} {BRAND.name}
          </p>
        </section>

        {/* ============ the way in ============ */}
        <section className="flex flex-1 items-center justify-center bg-[var(--surface-raised)] px-6 py-12 sm:px-10 lg:px-12">
          <div className="w-full min-w-0 max-w-[22rem]">
            <h1 className="text-[1.375rem] font-semibold tracking-tight text-[var(--text-primary)]">
              Welcome back
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">
              Your PIN identifies your account on its own. There is nothing
              else to enter.
            </p>

            {callbackError && (
              <div className="mt-5">
                <Alert tone="danger">{callbackError}</Alert>
              </div>
            )}

            <div className="mt-8">
              <SignInForm nextPath={next} />
            </div>

            {/* The context the band gave up on a phone, placed after the
                thing the person came to do rather than in front of it. */}
            <div className="mt-9 lg:hidden">
              <ul className="grid gap-3 border-t border-[var(--border-subtle)] pt-6">
                {CAPABILITIES.map(({ icon: Icon, label, note }) => (
                  <li key={label} className="flex items-start gap-3">
                    <Icon className="mt-0.5 size-4 shrink-0 text-gold-500" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[0.8125rem] font-medium text-[var(--text-primary)]">
                        {label}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">{note}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-7 text-center text-xs text-[var(--text-muted)]">
                © {new Date().getFullYear()} {BRAND.name}
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
