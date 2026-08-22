# The supplier portal

GAB Premium Ent

A link you give a supplier. They open it and see what has been ordered
from them, what has been booked in, and a form to send you their invoice.

No account, no password, nothing for you to provision or reset.

---

## Why a link and not a login

Suppliers ring up to ask what was ordered and what has been received.
Every one of those calls is somebody here reading a screen aloud.

The obvious fix — give them a login — is the wrong one. Accounts need
creating, resetting and deprovisioning, and a supplier's staff turn over
without telling you. Six months later you have twenty accounts and no
idea which of them belong to people who still work there.

A link is a capability rather than an identity. It expires on its own, it
can be revoked in one click, and issuing a replacement takes five
seconds.

---

## Issuing one

**Purchasing → the supplier → Issue a portal link.**

Give it a label — "their accounts department" — so two links can be told
apart later. Choose how long it lasts: 7, 30, 90, 180 days or a year.

**The link is shown once.** Copy it then. Only a digest of it is stored,
which means nobody here can look it up afterwards, including you. If it
is lost, revoke it and issue another.

Only a Super Administrator or senior manager can issue one.

---

## What the supplier sees

Their own orders: number, date, what was ordered, what has been booked
in, and what is still to come. Priced at what they charge you, which is
their own price and not a disclosure.

Below that, what they have already sent you and where each one has got
to. And below that, the form.

**They see nothing else.** No other supplier, no customer, no selling
price, and no order you have raised but not yet sent — an order still in
draft is not something a supplier should learn about.

The page carries no navigation into the rest of the system, because
there is nothing else there for them to reach.

---

## Sending you an invoice

The supplier fills in their company, their name, the invoice number, the
date and the amount, attaches a PDF or a photograph, and sends it.

It arrives attached to their supplier record — not in one person's inbox
— and the accounts team is notified.

Accepted: PDF, JPG, PNG, WebP, HEIC. Up to 20 MB.
Refused: everything else, including anything executable.

---

## Reviewing what arrives

**Purchasing → Supplier invoices**, or the supplier's own page.

The queue is oldest first, because the longest wait is the one about to
become a phone call. Each row shows what the supplier typed beside what
you hold, so a disagreement about the invoice number or the company name
is visible without opening the file.

Two decisions:

**Approve** — you agree the invoice is correct and it can be paid.

**Send back** — with a reason, which is required. The supplier reads that
reason and it is the only part of your review they see; an internal note
on an approved invoice stays internal. Without a reason they send you the
same thing again.

Only a manager, senior manager, Super Administrator or accountant can
approve one. Approving is agreeing to pay, so it is not a warehouse job.

---

## Revoking a link

The supplier's page lists every link, when it expires, when it was last
used and how many times. **Revoke** stops it immediately, wherever it has
been forwarded to — including a submission already being filled in.

Revoke when the person you sent it to leaves, when it has been forwarded
somewhere it should not have been, or when you simply no longer need it
open.

---

## What protects it

A link is a credential and is treated as one.

**Stored as a digest, never in full.** The link is generated on the
server and only its SHA-256 hash reaches the database — so it cannot
appear in a query log, a statement sample or a slow-query trace, and a
leaked database backup hands over nothing that works.

**Every link expires.** Between 1 and 365 days, enforced by the database.
A link with no end date is a permanent grant to whoever it was last
forwarded to.

**Revocable**, immediately, without waiting for expiry.

**Rate limited per address.** Ten failed attempts in fifteen minutes and
that address is refused for a while — including with a good link. Per
address rather than globally, so one person guessing cannot lock every
supplier out.

**Every attempt is recorded**, successful or not, with no part of the
link itself in the record.

**One supplier only.** The link is matched to the supplier at every step,
so it cannot be pointed at another supplier's orders by changing an
address.

**Nothing is exposed to the browser.** Neither an anonymous nor a
signed-in caller can execute the functions behind the portal — the server
resolves the link and reads on the supplier's behalf. The database's
position that anonymous callers get nothing is unchanged by this feature
existing.

**Marked noindex.** A link that turns up in a search result is a link
that has been published.

**Every failure looks the same.** Unknown, expired, revoked or rate
limited all render one message. Telling the holder of a bad link which it
was tells them how to make a better guess.

---

## Where the files live

A private Supabase Storage bucket. Never public: the documents in it
carry purchase prices, and a public bucket is readable by anybody who can
guess a URL.

Opening one mints a signed link that lasts five minutes, and it is minted
when somebody clicks rather than embedded in the listing — so no live
link to a supplier invoice sits in a page's source, a browser history or
a screenshot.

Access is checked twice: the row describing the file is read under the
reader's own session before a link is minted at all, and the storage
objects themselves carry their own policies. Storage is reachable
directly with an access token, so a rule on the table alone would leave
the files open to any signed-in driver.

---

## What to tell a supplier

> Here is a link to your account with GAB Premium Ent. You can see what
> we have ordered from you and what we have booked in, and you can send
> us your invoices through it.
>
> It works until [date] and it does not need a password. Please do not
> forward it — anybody holding it sees the same thing. If a colleague
> needs access, ask us and we will send them their own.
