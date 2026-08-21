import Link from "next/link";
import { BrandMark } from "@/components/layout/brand-mark";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="flex flex-col items-center text-center">
        <BrandMark className="mb-8" />
        <p className="text-xs font-semibold tracking-wider text-[var(--text-muted)] uppercase">
          404
        </p>
        <h1 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">Page not found</h1>
        <p className="mt-1 mb-6 text-sm text-[var(--text-secondary)]">
          That page does not exist, or you do not have access to it.
        </p>
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-[var(--radius-panel)] bg-brand-700 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-800 pointer-fine:h-9.5"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
