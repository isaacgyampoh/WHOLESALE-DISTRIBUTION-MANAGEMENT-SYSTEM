import type { Receipt } from "@/lib/receipts/receipt";
import { money, toNumber, receiptUnitLines } from "@/lib/receipts/receipt";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

/**
 * The body of a receipt, as the customer reads it.
 *
 * Shared by their own page and by staff previewing what was sent, so
 * the two cannot disagree about what a receipt says.
 */
export function ReceiptDocument({ receipt }: { receipt: Receipt }) {
  const isPayment = receipt.kind === "credit_payment";

  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Pair label="Date" value={WHEN.format(new Date(receipt.issuedAt))} />
        {receipt.reference && <Pair label="Sale" value={receipt.reference} numeric />}
        {receipt.servedBy && (
          <Pair label={isPayment ? "Received by" : "Served by"} value={receipt.servedBy} />
        )}
        {isPayment && receipt.method && (
          <Pair label="Paid by" value={String(receipt.method).replace(/_/g, " ")} />
        )}
      </dl>

      {isPayment ? (
        <div className="mt-6 space-y-2.5 border-t border-[var(--border-subtle)] pt-5 text-sm">
          <Line label="Previous balance" value={money(toNumber(receipt.balanceBefore))} />
          <Line label="Payment received" value={money(toNumber(receipt.amount))} strong />
          <div className="border-t border-[var(--border-subtle)] pt-2.5">
            <Line label="Remaining balance" value={money(toNumber(receipt.balanceAfter))} strong />
          </div>
        </div>
      ) : (
        <>
          <table className="mt-6 w-full border-t border-[var(--border-subtle)] pt-4 text-sm">
            <thead>
              <tr className="text-left">
                <th className="pt-4 pb-2 text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase">
                  Item
                </th>
                <th className="pt-4 pb-2 text-right text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase">
                  Qty
                </th>
                <th className="pt-4 pb-2 text-right text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase">
                  Price
                </th>
                <th className="pt-4 pb-2 text-right text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {(receipt.items ?? []).map((line, i) => {
                // One row per unit actually sold. A line of two cartons
                // and three singles is two priced rows under one product
                // name, because a single "Price" column cannot say which
                // rate applied to which half.
                const priced = receiptUnitLines(line, (n) => money(n));
                return priced.map((part, j) => (
                  <tr key={`${i}-${j}`}>
                    <td className="py-2.5 pr-2 text-[var(--text-primary)]">
                      {j === 0 ? line.name : ""}
                    </td>
                    <td className="numeric py-2.5 text-right">{part.what}</td>
                    <td className="numeric py-2.5 text-right">{part.each}</td>
                    <td className="numeric py-2.5 text-right">
                      {j === priced.length - 1 ? money(toNumber(line.lineTotal)) : ""}
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>

          <div className="mt-4 space-y-2 border-t border-[var(--border-subtle)] pt-4 text-sm">
            <Line label="Subtotal" value={money(toNumber(receipt.subtotal))} />
            {toNumber(receipt.taxTotal) > 0 && (
              <Line label="Tax" value={money(toNumber(receipt.taxTotal))} />
            )}
            <Line label="Total" value={money(toNumber(receipt.total))} strong />

            {(receipt.payments ?? []).map((p, i) => (
              <Line
                key={i}
                label={p.provider
                  ? `${String(p.method).replace(/_/g, " ")} · ${p.provider}`
                  : String(p.method).replace(/_/g, " ")}
                value={money(toNumber(p.amount))}
                muted
              />
            ))}

            {toNumber(receipt.balance) > 0 && (
              <div className="border-t border-[var(--border-subtle)] pt-2">
                <Line label="Outstanding" value={money(toNumber(receipt.balance))} strong />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Pair({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)] uppercase">
        {label}
      </dt>
      <dd className={`mt-0.5 text-[var(--text-primary)] ${numeric ? "numeric" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function Line({
  label, value, strong, muted,
}: {
  label: string; value: string; strong?: boolean; muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={muted ? "text-xs text-[var(--text-muted)]" : "text-[var(--text-secondary)]"}>
        {label}
      </span>
      <span
        className={[
          "numeric",
          strong ? "text-base font-semibold text-[var(--text-primary)]" : "",
          muted ? "text-xs text-[var(--text-muted)]" : "text-[var(--text-primary)]",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
