"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadProductImageAction, removeProductImageAction } from "./actions";
import { INITIAL_CATALOGUE_STATE } from "./state";
import { productImageUrl, describeImageRefusal } from "@/lib/catalogue/image";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { ImagePlus, Trash2 } from "lucide-react";

/**
 * The picture on a product.
 *
 * Chosen with the phone's own camera or gallery — `capture` is
 * deliberately absent so the person can pick an existing photograph
 * rather than being forced to take one at a desk.
 *
 * The file is checked here before it is sent, using the same rules the
 * server applies. That is not the control — the server and the bucket
 * both refuse independently — it is so somebody on a slow connection
 * finds out before uploading four megabytes rather than after.
 */
export function ProductImageForm({
  productId,
  productName,
  imagePath,
}: {
  productId: string;
  productName: string;
  imagePath: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localRefusal, setLocalRefusal] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const [uploadState, upload, uploading] = useActionState(
    uploadProductImageAction, INITIAL_CATALOGUE_STATE);
  const [removeState, remove, removing] = useActionState(
    removeProductImageAction, INITIAL_CATALOGUE_STATE);

  const current = preview ?? productImageUrl(imagePath);
  const message = localRefusal
    ?? (uploadState.status === "error" ? uploadState.message : null)
    ?? (removeState.status === "error" ? removeState.message : null);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current}
            alt={`${productName}`}
            className="size-24 shrink-0 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] object-cover"
          />
        ) : (
          <div className="grid size-24 shrink-0 place-items-center rounded-[var(--radius-panel)] border border-dashed border-[var(--border-strong)] text-[var(--text-muted)]">
            <ImagePlus className="size-6" aria-hidden />
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm text-[var(--text-secondary)]">
            Shown on the till, so a salesperson can tell one size from another at
            a glance. JPEG, PNG or WebP, up to 5 MB.
          </p>

          <form
            action={upload}
            className="flex flex-wrap items-center gap-2"
            onSubmit={() => setLocalRefusal(null)}
          >
            <input type="hidden" name="productId" value={productId} />
            <input
              ref={inputRef}
              type="file"
              name="image"
              accept="image/jpeg,image/png,image/webp"
              className="block w-full text-sm text-[var(--text-secondary)] file:mr-3 file:h-11 file:rounded-[var(--radius-panel)] file:border file:border-[var(--border-strong)] file:bg-[var(--surface-sunken)] file:px-3 file:text-sm file:text-[var(--text-primary)] pointer-fine:file:h-9"
              onChange={(e) => {
                const file = e.target.files?.[0];
                setLocalRefusal(null);
                setPreview(null);
                if (!file) return;
                const refusal = describeImageRefusal({ type: file.type, size: file.size });
                if (refusal) {
                  setLocalRefusal(refusal);
                  e.target.value = "";
                  return;
                }
                // Shown immediately, so the choice is confirmed before
                // the upload finishes.
                setPreview(URL.createObjectURL(file));
              }}
            />
            <Button type="submit" size="sm" loading={uploading} disabled={Boolean(localRefusal)}>
              {imagePath ? "Replace picture" : "Set picture"}
            </Button>
          </form>

          {imagePath && (
            <form action={remove}>
              <input type="hidden" name="productId" value={productId} />
              <Button type="submit" size="sm" variant="ghost" loading={removing}>
                <Trash2 className="size-4" aria-hidden />
                Remove it
              </Button>
            </form>
          )}
        </div>
      </div>

      {message && <Alert tone="danger">{message}</Alert>}

      {uploadState.status === "done" && (
        <Alert tone="success">
          {uploadState.message}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => { setPreview(null); router.refresh(); }}
          >
            Refresh
          </button>
        </Alert>
      )}

      {removeState.status === "done" && (
        <Alert tone="success">{removeState.message}</Alert>
      )}
    </div>
  );
}
