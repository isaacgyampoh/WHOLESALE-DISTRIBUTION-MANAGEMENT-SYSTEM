# Who can do what

GAB Premium Ent

Eight roles. This is what each one can reach and, more usefully, what
each one deliberately cannot.

**A driver is not a salesperson.** A van goes out with a driver who
drives it and one or more people who sell from it. Those are different
jobs, different accountability, and different people — the driver
answers for the vehicle and its load, the salespeople for the money.
This is enforced in the database, not by which buttons each one is
shown: a driver cannot open a sale even by calling the API directly.

Everything below is enforced by the database, not by the menu. Hiding a
button is not security — a person who types the address of a screen they
should not have is refused there, and a request that gets past the
application entirely is still refused by row level security.

---

## The roles at a glance

| | Super Admin | Senior mgr | Manager | Warehouse | Accountant | Sales rep | **Salesperson** | **Driver** |
|---|---|---|---|---|---|---|---|---|
| Sees cost price and margin | ● | ● | ● | ● | ● | | | |
| Creates and edits products | ● | ● | ● | | | | | |
| Adjusts stock | ● | ● | ● | ● | | | | |
| **Approves a transfer** | ● | ● | ● | | | | | |
| Dispatches and receives transfers | ● | ● | ● | ● | | | | |
| Builds and dispatches van loads | ● | ● | ● | ● | | | | |
| **Crews a van** | ● | ● | ● | ● | | | | |
| Approves returns | ● | ● | ● | ● | | | | |
| Approves an end of day | ● | ● | ● | | ● | | | |
| **Sells from a van** | ● | ● | ● | | | ● | ● | |
| **Takes payments** | ● | ● | ● | | ● | | ● | |
| Creates a customer | ● | ● | ● | | | ● | ● | |
| Confirms a load for the road | ● | ● | ● | | | | | ● |
| Submits a return | ● | ● | ● | ● | | | ● | ● |
| Submits an end of day | ● | ● | ● | | | | ● | ● |
| **Approves a supplier invoice** | ● | ● | ● | | ● | | | |
| Issues a waybill | ● | ● | ● | ● | | | | |
| Issues a supplier portal link | ● | ● | | | | | | |
| Manages staff and PINs | ● | ● | | | | | | |
| **Changes what a role can do** | ● | | | | | | | |
| Reads the audit trail | ● | ● | | | | | | |

---

## The separations that matter

Five rules exist specifically so that one person cannot complete a loop
on their own. They are the reason several roles look narrower than you
might expect.

**A driver cannot sell, and a salesperson cannot drive.**
The van's crew list says which job each person holds, and the database
checks it: selling requires being crewed *to sell*, not merely being
aboard. A van with nobody crewed to sell cannot be dispatched at all —
goods would leave the warehouse with no way to record what happened to
them.

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

Never visible to: sales rep, salesperson, driver.

This is not a hidden column. Cost is withdrawn from the API entirely for
those roles, so it is not in the response a browser receives, not in the
snapshot a field phone caches, and not in any report they can export. A
salesperson who inspected the network traffic would find no cost figure
to read.

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

### Salesperson

The field seller. Sells from the van they are crewed on, creates
customers at the roadside, takes cash, mobile money, split payments and
approved credit, collects on account, and closes their day.

Their application is the round and nothing else, built for a phone used
one-handed outside a shop, and it works with no signal.

No cost price anywhere, by any route. See `docs/DRIVER_GUIDE.md`.

### Driver

The vehicle. Which van is mine, what is on it, who is selling from it
today, what is coming back. They sign for the load before it leaves the
yard — the goods are their responsibility on the road.

They deliberately hold neither `sales.create` nor `payments.create`.
They can see what the round sold, because it is their van, but they
cannot record a sale or take a payment. Before the crew model they could
do both, which put the wrong name on every receipt.

No cost price anywhere.

### Sales rep

Office-based sales. Customers, orders, what is in stock, what is owed.
No van, no round, no crew. Distinct from a salesperson, who is crewed on
a vehicle and sells from it in the field.

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
