import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * How the Next build is adapted for Workers.
 *
 * Deliberately bare. The defaults give an in-memory incremental cache
 * and no tag revalidation, which is right for this application: almost
 * nothing is statically cached. Every screen behind sign-in reads the
 * database per request through RLS, so a shared cache would be a way to
 * serve one organization's figures to another - the exact failure the
 * security_invoker views exist to prevent.
 *
 * KV or R2 caching can be added later if a genuinely public, genuinely
 * static page appears. None exists today.
 */
export default defineCloudflareConfig();
