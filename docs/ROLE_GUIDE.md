# Who can do what

GAB Premium Ent

Seven roles. This is what each one can reach and, more usefully, what
each one deliberately cannot.

Everything below is enforced by the database, not by the menu. Hiding a
button is not security — a person who types the address of a screen they
should not have is refused there, and a request that gets past the
application entirely is still refused by row level security.

---

## The roles at a glance

| | Super Administrator | Senior manager | Manager | Warehouse | Accountant | Sales rep | Driver |
|---|---|---|---|---|---|---|---|
| Sees cost price and margin | ● | ● | ● | ● | ● | | |
| Creates and edits products | ● | ● | ● | | | | |
| Adjusts stock | ● | ● | ● | ● | | | |
| **Approves a transfer** | ● | ● | ● | | | | |
| Dispatches and receives transfers | ● | ● | ● | ● | | | |
| Builds and dispatches van loads | ● | ● | ● | ● | | | |
| Approves returns | ● | ● | ● | ● | | | |
| Approves an end of day | ● | ● | ● | | ● | | |
| Sells from a van | ● | ● | ● | | | ● | ● |
| Takes payments | ● | ● | ● | | ● | | ● |
| **Approves a supplier invoice** | ● | ● | ● | | ● | | |
| Issues a waybill | ● | ● | ● | ● | | | |
| Issues a supplier portal link | ● | ● | | | | | |
| Manages staff and PINs | ● | ● | | | | | |
| **Changes what a role can do** | ● | | | | | | |
| Reads the audit trail | ● | ● | | | | | |

---

## The separations that matter

Four rules exist specifically so that one person cannot complete a loop
on their own. They are the reason several roles look narrower than you
might expect.

**A driver cannot approve their own end of day.**
Counting the cash and agreeing the count are two jobs. Enforced by a
constraint, by row level security, and by a check inside the approval
function — three times, because it is the one that money walks out of.

**A warehouse cannot approve its own transfer.**
The warehouse raises transfers and ships them; a manager agrees they
should move. A depot that could do both could move stock wherever it
liked and produce a document saying it was authorised.

**The warehouse cannot approve a supplier invoice.**
Approving one is agreeing to pay it. That belongs with whoever is
accountable for the money, not with whoever unloaded the lorry.

**A storeman can file a supplier document but not delete one.**
Removing a document that a dispute may later turn on is a decision
somebody senior has to make.

---

## Cost price

Visible to: Super Administrator, senior manager, manager, warehouse,
accountant.

Never visible to: sales rep, driver.

This is not a hidden column. Cost is withdrawn from the API entirely for
those roles, so it is not in the response a browser receives, not in the
snapshot a driver's phone caches, and not in any report they can export.
A driver who inspected the network traffic would find no cost figure to
read.

The same rule covers unit cost on a van load, purchase prices, supplier
terms, warehouse valuation and gross margin.

---

## Role by role

### Super Administrator

Everything, including the two things nobody else gets: changing what a
role can do, and reading the audit trail.

Their dashboard is about the system rather than the trading — who can
sign in, whether anybody is trying who should not, what is waiting on a
decision, and whether the database is running the schema this build
expects. That last one matters: a database behind the application makes
features quietly absent rather than broken, so it is named rather than
left to be discovered.

### Senior manager

Everything a Super Administrator can do except change the permission map
itself. In practice: the person who runs the business day to day.

### Manager

Trading and stock, and the approvals that keep the separations above
honest — transfers, returns, end of day, supplier invoices. Sees cost and
margin. Cannot manage staff or read the audit trail.

Where a manager is restricted to particular product categories, every
figure they see is scoped to those categories. The number on their
screen is what they are accountable for, not a company total.

### Warehouse

Goods, not money. Receiving, dispatching, transfers, returns, stock
adjustments, waybills. Sees cost, because valuing what is on the shelf is
part of the job.

Cannot approve a transfer, take a payment, or approve a supplier invoice.

Their dashboard is ordered by what blocks something else: expired stock
stops a van dispatching at all, a load waiting to go out holds up a
round, and a transfer nobody has booked in is stock the business cannot
see anywhere.

### Accountant

The books. Invoices, receipts, collections, credit ageing, supplier
payables, end-of-day review, financial reports. Sees cost.

Cannot move stock, cannot sell, cannot issue a waybill.

Their dashboard leads with ageing rather than a single outstanding
figure, because a total hides the only thing that matters about a debt —
forty thousand cedi inside terms is a healthy book and the same figure at
ninety days is a write-off waiting to be admitted.

### Sales rep

Sells, creates customers, sees what is in stock and what customers owe.
No cost, no margin, no stock movements, no approvals.

### Driver

The round, and nothing else. Sell, take money, collect on credit, return
goods, close the day. Their whole application is built for a phone used
one-handed outside a shop, and it works with no signal.

No cost anywhere. See `docs/DRIVER_GUIDE.md`.

---

## Changing what a role can do

Only a Super Administrator, on the Permissions screen.

The map is deliberately small and blunt. Adding a permission to a role
changes what the interface offers that role — it does **not** change what
the database allows. The two are kept in step on purpose, and a
permission granted here that the database refuses will produce a button
that fails rather than a capability that works. If you need a genuinely
new capability, that is a change to the database rules, not to this
screen.
