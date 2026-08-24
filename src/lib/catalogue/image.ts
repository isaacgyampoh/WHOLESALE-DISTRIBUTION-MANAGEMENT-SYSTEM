/**
 * Where a product photograph lives.
 *
 * The bucket is public on purpose (migration 0037), so this is plain
 * string assembly rather than a signed-URL round trip. That matters in
 * the field: a phone offline in a van cannot mint a signed URL, and the
 * service worker caches by URL - a signed one is different every time
 * and would never hit the cache.
 */
const BUCKET = "product-images";

export function productImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;

  // Already a full URL - a product imported with an external image.
  if (/^https?:\/\//i.test(path)) return path;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;

  return `${base}/storage/v1/object/public/${BUCKET}/${path.replace(/^\/+/, "")}`;
}

/** What a picture is allowed to be, matched to the bucket's own limits. */
export const PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export function describeImageRefusal(file: { type: string; size: number }): string | null {
  if (!PRODUCT_IMAGE_TYPES.includes(file.type as (typeof PRODUCT_IMAGE_TYPES)[number])) {
    return "That has to be a JPEG, PNG or WebP.";
  }
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    return "That picture is over 5 MB. Resize it — it has to travel down a phone connection.";
  }
  return null;
}
