/**
 * The caller's address, whichever header this host puts it in.
 *
 * Every edge names it differently and sets only its own. Vercel sends
 * X-Forwarded-For; Cloudflare sends CF-Connecting-IP and does not send
 * X-Forwarded-For at all. Code that reads one header works on one host
 * and silently records nothing on the other.
 *
 * Silently is the problem. Nothing errors - the address is simply null,
 * the audit row says the change came from nowhere, and the sign-in
 * lockout falls back to the device cookie alone. A cookie is something
 * the person guessing controls: clear it, or open a private window, and
 * the five-attempt limit starts again from zero. Against a four-digit
 * PIN that is the whole protection gone, and nothing on any screen
 * would have said so.
 *
 * Ordered by trustworthiness. CF-Connecting-IP is written by the edge
 * and cannot be set by the client. X-Forwarded-For can be, which is why
 * only its first entry is read, and why none of this ever informs
 * authorization - it rate-limits and it fills the audit log.
 *
 * One implementation on purpose. Three copies of this rule is how two
 * of them come to disagree.
 */
export function clientIp(headers: Headers): string | null {
  const direct = headers.get("cf-connecting-ip") ?? headers.get("x-real-ip");
  if (direct?.trim()) return direct.trim();
  const forwarded = headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || null;
}
