import type { Metadata } from "next";
import {
  resolvePortalSession, getPortalOrders, getPortalOrderLines,
} from "@/features/suppliers/portal-queries";
import { BRAND } from "@/lib/brand";
import { formatMoney, formatDate, formatQuantity } from "@/lib/utils/format";
import { PackageSearch, ShieldAlert } from "lucide-react";

/**
 * What a supplier sees.
 *
 * No account, no password, no navigation into the rest of the system -
 * this page has no shell around it, because the shell belongs to people
 * who work here. What is on it is one supplier's own orders and nothing
 * else.
 *
 * Never indexed. A link that ends up in a search result is a link that
 * has been published.
 */
export const metadata: Metadata = {
  title: "Your orders",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  submitted: "Placed with you",
  partially_received: "Part received",
  received: "Received in full",
  cancelled: "Cancelled",
};

export default async function PortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await resolvePortalSession(token);

  // One message for every kind of failure. Telling the holder of a bad
  // link whether it was unknown, expired or revoked tells them how to
  // make a better guess.
  if (!session) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        <ShieldAlert className="size-10 text-[var(--text-muted)]" aria-hidden />
        <h1 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
          This link does not work
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          It may have expired or been replaced. Ask your contact at {BRAND.name} for a new one.
        </p>
      </main>
    );
  }

  const orders = await getPortalOrders(session);

  // The lines of every order are fetched together rather than behind a
  // click: a supplier checking what was ordered wants to see it, and
  // there is no navigation here to click into.
  const lines = await Promise.all(
    orders.map(async (order) => ({
      order,
      items: await getPortalOrderLines(session, order.id),
    })),
  );

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      <header className="border-b border-[var(--border-strong)] pb-6">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {session.organizationName || BRAND.name}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          Orders with {session.supplierName}
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          What has been ordered from you and what we have booked in so far. This link works
          until {formatDate(session.expiresAt)}.
        </p>
      </header>

      {orders.length === 0 ? (
        <div className="mt-16 text-center">
          <PackageSearch className="mx-auto size-10 text-[var(--text-muted)]" aria-hidden />
          <h2 className="mt-4 text-base font-medium text-[var(--text-primary)]">
            No orders yet
          </h2>
          <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
            Nothing has been placed with you that we have sent out.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {lines.map(({ order, items }) => (
            <section
              key={order.id}
              className="overflow-hidden rounded-lg border border-[var(--border-subtle)]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-5 py-3.5">
                <div>
                  <p className="numeric text-sm font-semibold text-[var(--text-primary)]">
                    {order.poNumber}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    Placed {formatDate(order.orderDate)}
                    {order.expectedDate ? ` · expected ${formatDate(order.expectedDate)}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="numeric text-sm font-semibold text-[var(--text-primary)]">
                    {formatMoney(order.total)}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {STATUS_LABELS[order.status] ?? order.status}
                  </p>
                </div>
              </div>

              {items.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[30rem] text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)] text-left">
                        <th className="px-5 py-2 font-medium text-[var(--text-secondary)]">Item</th>
                        <th className="px-3 py-2 text-right font-medium text-[var(--text-secondary)]">
                          Ordered
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-[var(--text-secondary)]">
                          Received
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-[var(--text-secondary)]">
                          Unit
                        </th>
                        <th className="px-5 py-2 text-right font-medium text-[var(--text-secondary)]">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {items.map((line, i) => {
                        const outstanding = line.quantity - line.qtyReceived;
                        return (
                          <tr key={i}>
                            <td className="px-5 py-2.5">
                              <span className="text-[var(--text-primary)]">{line.productName}</span>
                              <span className="numeric ml-2 text-xs text-[var(--text-muted)]">
                                {line.sku}
                              </span>
                            </td>
                            <td className="numeric px-3 py-2.5 text-right">
                              {formatQuantity(line.quantity)}
                            </td>
                            <td className="numeric px-3 py-2.5 text-right">
                              {formatQuantity(line.qtyReceived)}
                              {/* What is still owed to us, which is the
                                  one figure a supplier is looking for. */}
                              {outstanding > 0 && (
                                <span className="ml-1.5 text-xs text-[var(--text-muted)]">
                                  ({formatQuantity(outstanding)} to come)
                                </span>
                              )}
                            </td>
                            <td className="numeric px-3 py-2.5 text-right">
                              {formatMoney(line.unitCost)}
                            </td>
                            <td className="numeric px-5 py-2.5 text-right">
                              {formatMoney(line.lineTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <footer className="mt-12 border-t border-[var(--border-subtle)] pt-5 text-xs text-[var(--text-muted)]">
        <p>
          This page is for {session.supplierName} only. Please do not forward the link -
          anybody holding it sees the same thing. If it needs to go to a colleague, ask us for
          one of their own.
        </p>
      </footer>
    </main>
  );
}
