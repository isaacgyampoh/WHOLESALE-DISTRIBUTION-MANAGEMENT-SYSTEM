# Running the system

GAB Premium Ent — for whoever administers it.

---

## Your dashboard

Four things, and none of them are trading figures except the first two.

**Revenue and gross margin.** Margin is revenue less what the goods cost.
It is computed only for roles allowed to see cost, and where a cost is
unknown it is left out rather than counted as zero — reporting a whole
sale as margin is worse than reporting none of it.

**Waiting on somebody.** Every approval across the system: end of day,
returns, transfers, supplier invoices. Anything sitting here is work that
has stopped.

**The system itself.** Who can sign in, whether anybody is trying who
should not, and — the one that matters most — **whether the database is
running the schema this build expects**.

That last one is worth understanding. The application and the database
are deployed separately, on purpose: a migration is never applied by a
code deploy. So there is always a window where the code is ahead. When
that happens features go *quietly absent* rather than breaking, which
means nobody reports them. The panel names which upgrade scripts are
outstanding so it is not left to be discovered.

---

## Staff

**Staff → Add.** Name, role, PIN. There is no email invitation and no
password — the PIN is the whole credential.

**Give everybody their own account.** The audit trail is only worth
having if a name in it means one person.

**A PIN is stored as a digest** under a server-side secret, so nobody —
including you — can read one back. You can reset one; you cannot look one
up.

**Deactivating is not deleting.** A deactivated person cannot sign in but
everything they did stays attributed to them. Deleting somebody who has
sold anything is neither possible nor desirable.

Somebody active with no PIN set cannot sign in at all, and nobody finds
out until they try. The dashboard counts them for exactly that reason.

---

## Permissions

**Permissions**, and only you can reach it.

The map decides what the interface *offers*. It does not decide what the
database *allows* — those are kept in step deliberately, and granting a
permission here that the database refuses produces a button that fails
rather than a capability that works.

Four separations exist so one person cannot complete a loop alone. Think
carefully before undoing any of them:

- a driver cannot approve their own end of day
- a warehouse cannot approve its own transfer
- the warehouse cannot approve a supplier invoice
- a storeman can file a supplier document but not delete one

See `docs/ROLE_GUIDE.md` for the full matrix.

---

## The audit trail

**Audit.** Append-only: nobody can edit or delete an entry, including
you. Enforced by the database, not by the application.

It records who did what and when, for everything financial, everything
that moves stock, and everything to do with access. Secrets are scrubbed
before writing — PIN digests and portal links never appear in it. An
audit trail that records credentials is a place to steal them from.

**Read it weekly.** It is only useful if somebody looks.

---

## Notifications

Two different things, told apart, because they behave differently.

**Events** happened once and stay true — a driver closed their day, a
transfer needs approving, a supplier sent an invoice. Somebody reads them
and they are done.

**Conditions** are true until they stop — stock below reorder, money past
due, goods still on the road. Nobody reads one of these away; it ends
when the stock is replenished or the invoice is paid.

Conditions are recomputed in place rather than appended, so the bell
never fills with repeats of the same fact. The recompute runs when a
dashboard loads, which means **no scheduler is needed** and this works on
a database with no cron installed.

Notifications are addressed to a **job** rather than a person: "a
transfer needs approving" is for whoever is managing today, not for one
named manager who might be on leave. Nobody can write one — a
notification a browser could insert is a way to report something that did
not happen.

---

## Products and pricing

**Cost price is management information.** It is withdrawn from the API
for drivers and sales reps entirely, so it is absent from the responses
their browsers receive and from the snapshot their phones cache. This is
not a hidden column.

**Selling price changes are audited.** So are cost changes.

**Batch and expiry tracking is off by default** and turned on per
product. A crate does not expire and should not be made to carry a date.
Once on, the delivery has to carry a batch number and an expiry, and
nothing expired can be loaded onto a van or transferred to another depot
— transferring it would only relocate the write-off.

---

## Stock

**Stock is derived, never set.** Every quantity comes from an
append-only ledger of movements. There is no field anywhere that writes a
stock level directly, and the database refuses updates and deletes on
that ledger.

A correction is a reversing entry, which is why the movements screen
sometimes shows two rows where you expected one. That is the ledger
working.

**A transfer is not two adjustments.** Between dispatch and receipt the
goods belong to neither depot and appear in no stock summary — which is
the honest position, and why goods in transit have a report of their own.

---

## Credit

A customer's limit is checked at the point of sale, in the database. A
sale beyond it is refused and the driver is told by how much. That
refusal cannot be overridden from the van, on purpose.

**Collections settle the oldest invoice first**, which is what both
parties normally want. Money beyond what is owed stays on account rather
than being forced onto an invoice that has not been raised yet.

Ageing is the number to watch, not the total. Forty thousand cedi inside
terms is a healthy book; the same figure at ninety days is a write-off
waiting to be admitted.

---

## Suppliers

See `docs/SUPPLIER_PORTAL.md`. In short: you issue a link, the supplier
sends invoices through it, and somebody here approves or sends each one
back.

Approving is agreeing to pay, so it needs a manager, senior manager,
Super Administrator or accountant — not the warehouse.

---

## Reports

Fourteen, grouped as trading, stock and money. Every one exports to CSV
and the whole page prints.

**Export authorisation is on the route, not the button.** A URL is
something anybody with a session can type, so the financial exports are
gated on the same permission the screen uses. A role without it gets
refused, not a file.

Rows come from the same queries the screen uses, under the reader's own
session — so a category manager exports their categories, and an export
can never show more than the page did.

---

## When something looks wrong

**A feature is missing rather than broken.** An upgrade script has not
been run. Your dashboard names it.

**A figure disagrees with what somebody expects.** Check the audit trail
and the stock movements before assuming the system is wrong. Both are
complete, and both are append-only.

**A driver's sale did not appear.** Check their queue under
`/driver/queue` and the notifications — a failed sync raises a critical
one, because the device believes the sale was recorded and the customer
will otherwise be charged twice or not at all.

**Somebody cannot sign in.** Either the account is deactivated, or it has
no PIN set, or they have failed too many attempts and are rate limited.
All three are visible on their staff record.
