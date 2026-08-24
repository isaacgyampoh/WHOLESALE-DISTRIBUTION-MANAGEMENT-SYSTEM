"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  uploadSupplierDocumentAction, deleteSupplierDocumentAction,
  issuePortalLinkAction, revokePortalLinkAction, openDocumentAction,
} from "./actions";
import { INITIAL_SUPPLIER_STATE } from "./state";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { Upload, Link2, Trash2, Download, Copy, Check, ExternalLink } from "lucide-react";

const KINDS = [
  { value: "invoice", label: "Invoice" },
  { value: "delivery_note", label: "Delivery note" },
  { value: "waybill", label: "Waybill" },
  { value: "credit_note", label: "Credit note" },
  { value: "certificate", label: "Certificate" },
  { value: "contract", label: "Contract" },
  { value: "other", label: "Other" },
];

/**
 * Filing a document that came in with a delivery.
 *
 * The accepted types are listed on the field rather than discovered by
 * being refused. The limit is stated for the same reason: somebody
 * photographing an invoice on a phone has no idea what twenty megabytes
 * looks like until they are told they have exceeded it.
 */
export function UploadDocumentButton({
  supplierId,
  orders,
}: {
  supplierId: string;
  orders: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    uploadSupplierDocumentAction, INITIAL_SUPPLIER_STATE);

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload className="size-4" aria-hidden />
        File a document
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="File a supplier document"
        description="Kept privately. Only the office can open it, and only through a link that expires in minutes."
        className="sm:max-w-lg"
      >
        {state.status === "done" ? (
          <div className="space-y-4">
            <Alert tone="success">{state.message}</Alert>
            <Button className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            {state.status === "error" && state.message && (
              <Alert tone="danger">{state.message}</Alert>
            )}
            <input type="hidden" name="supplierId" value={supplierId} />

            <Field label="File" htmlFor="file" required
                   hint="PDF, photograph or spreadsheet, up to 20 MB."
                   error={state.fieldErrors?.file}>
              <input
                id="file"
                name="file"
                type="file"
                required
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.csv,.xls,.xlsx"
                className="block w-full text-sm text-[var(--text-secondary)] file:mr-3 file:rounded-md file:border file:border-[var(--border-strong)] file:bg-[var(--surface-sunken)] file:px-3 file:py-2 file:text-sm file:text-[var(--text-primary)]"
              />
            </Field>

            <Field label="What it is" htmlFor="title" required
                   hint="Something recognisable six weeks from now."
                   error={state.fieldErrors?.title}>
              <Input id="title" name="title" required placeholder="Acme invoice 8891"
                     defaultValue={state.values?.title} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kind" htmlFor="kind" error={state.fieldErrors?.kind}>
                <Select id="kind" name="kind" defaultValue={state.values?.kind ?? "invoice"}>
                  {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </Select>
              </Field>

              <Field label="Their reference" htmlFor="reference" hint="Optional.">
                <Input id="reference" name="reference" defaultValue={state.values?.reference} />
              </Field>

              <Field label="Document date" htmlFor="documentDate" hint="What the paper says.">
                <Input id="documentDate" name="documentDate" type="date"
                       defaultValue={state.values?.documentDate} />
              </Field>

              <Field label="Amount" htmlFor="amount" hint="Optional, in cedi."
                     error={state.fieldErrors?.amount}>
                <Input id="amount" name="amount" inputMode="decimal" placeholder="0.00"
                       defaultValue={state.values?.amount} />
              </Field>
            </div>

            {orders.length > 0 && (
              <Field label="Against which order" htmlFor="purchaseOrderId" hint="Optional.">
                <Select id="purchaseOrderId" name="purchaseOrderId"
                        defaultValue={state.values?.purchaseOrderId}>
                  <option value="">Not tied to an order</option>
                  {orders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </Select>
              </Field>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" loading={pending}>
                File it
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

/**
 * Opening a document.
 *
 * The URL is minted when this is clicked, not when the page rendered.
 * Putting signed URLs in the listing would mean every document on screen
 * had a live link to it, whether or not anybody opened one - and those
 * links would sit in the page source, the browser history and any
 * screenshot of it.
 */
export function OpenDocumentButton({ documentId, fileName }: {
  documentId: string;
  fileName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await openDocumentAction(documentId);
          setBusy(false);
          if (result.ok) window.open(result.url, "_blank", "noopener,noreferrer");
          else setError(result.message);
        }}
      >
        <Download className="size-3.5" aria-hidden />
        <span className="sr-only">Open {fileName}</span>
        Open
      </Button>
      {error && <p className="mt-1 text-xs text-critical">{error}</p>}
    </>
  );
}

export function DeleteDocumentButton({ documentId, title }: {
  documentId: string;
  title: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    deleteSupplierDocumentAction, INITIAL_SUPPLIER_STATE);

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  return (
    <>
      <button
        type="button"
        aria-label={`Remove ${title}`}
        onClick={() => setOpen(true)}
        className="grid size-11 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-critical pointer-fine:size-9"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>

      <Dialog open={open} onClose={close} title={`Remove ${title}`}
              description="The file goes with it. If a dispute later turns on this document, it will not be there.">
        {state.status === "done" ? (
          <div className="space-y-4">
            <Alert tone="success">{state.message}</Alert>
            <Button className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            {state.status === "error" && state.message && (
              <Alert tone="danger">{state.message}</Alert>
            )}
            <input type="hidden" name="documentId" value={documentId} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={close} disabled={pending}>
                Keep it
              </Button>
              <Button type="submit" variant="danger" className="flex-1" loading={pending}>
                Remove
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

/**
 * Issuing a portal link.
 *
 * The link is shown once and then never again, because only its digest
 * is kept. That is stated on the dialog rather than discovered later by
 * somebody looking for where it went.
 */
export function IssuePortalLinkButton({
  supplierId, supplierName, size, label = "Issue a portal link",
}: {
  supplierId: string;
  supplierName: string;
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [state, formAction, pending] = useActionState(
    issuePortalLinkAction, INITIAL_SUPPLIER_STATE);

  const close = () => {
    setOpen(false);
    setCopied(false);
    if (state.status === "done") router.refresh();
  };

  const url =
    state.issuedLink && typeof window !== "undefined"
      ? `${window.location.origin}/portal/${state.issuedLink}`
      : state.issuedLink
        ? `/portal/${state.issuedLink}`
        : "";

  return (
    <>
      <Button variant="secondary" size={size} onClick={() => setOpen(true)}>
        <Link2 className="size-4" aria-hidden />
        {label}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={`Invoice portal for ${supplierName}`}
        description="Send this secure link to the supplier so they can submit invoice documents. No account, no password."
        className="sm:max-w-lg"
      >
        {state.status === "done" && state.issuedLink ? (
          <div className="space-y-4">
            <Alert tone="success">{state.message}</Alert>
            <Alert tone="warning" title="Copy it now">
              Only a digest of this link is stored, so it cannot be shown again. If it is lost,
              issue a new one and revoke this.
            </Alert>

            <div className="rounded-[var(--radius-panel)] border border-[var(--border-strong)] bg-[var(--surface-sunken)] p-3">
              <code className="block break-all text-xs text-[var(--text-primary)]">{url}</code>
            </div>

            <Button
              className="w-full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                } catch {
                  // Clipboard access can be refused; the link is on
                  // screen to select by hand either way.
                  setCopied(false);
                }
              }}
            >
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            {/* Opening it here is how somebody checks the link works
                before sending it; it is the supplier's own page, and
                holding it is the whole of the access it grants. */}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="size-4" aria-hidden />
              Open portal
            </Button>
            <Button variant="ghost" className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            {state.status === "error" && state.message && (
              <Alert tone="danger">{state.message}</Alert>
            )}
            <input type="hidden" name="supplierId" value={supplierId} />

            <Field label="What it is for" htmlFor="label"
                   hint="So two links can be told apart later. Optional.">
              <Input id="label" name="label" placeholder="Their accounts department"
                     defaultValue={state.values?.label} />
            </Field>

            <Field label="Lasts for" htmlFor="days" required
                   hint="A link with no end date is a permanent grant to whoever it gets forwarded to."
                   error={state.fieldErrors?.days}>
              <Select id="days" name="days" defaultValue={state.values?.days ?? "30"}>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">A year</option>
              </Select>
            </Field>

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" loading={pending}>
                Issue link
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

export function RevokePortalLinkButton({ tokenId, hint }: { tokenId: string; hint: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    revokePortalLinkAction, INITIAL_SUPPLIER_STATE);

  const close = () => {
    setOpen(false);
    if (state.status === "done") router.refresh();
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Revoke
      </Button>

      <Dialog open={open} onClose={close} title={`Revoke link ${hint}…`}
              description="It stops working immediately, wherever it has been forwarded to.">
        {state.status === "done" ? (
          <div className="space-y-4">
            <Alert tone="success">{state.message}</Alert>
            <Button className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            {state.status === "error" && state.message && (
              <Alert tone="danger">{state.message}</Alert>
            )}
            <input type="hidden" name="tokenId" value={tokenId} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1"
                      onClick={close} disabled={pending}>
                Leave it
              </Button>
              <Button type="submit" variant="danger" className="flex-1" loading={pending}>
                Revoke
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
