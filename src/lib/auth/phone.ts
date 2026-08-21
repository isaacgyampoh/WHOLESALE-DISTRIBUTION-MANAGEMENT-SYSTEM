/**
 * Phone numbers are stored and compared in E.164, so the same person
 * cannot end up with two spellings of one number.
 *
 * Ghana is the default country: a local 0XXXXXXXXX becomes +233XXXXXXXXX.
 * Anything already carrying a + is kept as given.
 */
const DEFAULT_COUNTRY_CODE = "233";

export function normalisePhone(input: string): string | null {
  const trimmed = input.trim().replace(/[\s()\-.]/g, "");
  if (!trimmed) return null;

  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  // Local form: drop the trunk zero and prefix the country code.
  if (digits.startsWith("0")) {
    const national = digits.slice(1);
    return national.length >= 8 ? `+${DEFAULT_COUNTRY_CODE}${national}` : null;
  }

  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) return `+${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

/**
 * What the interface may show. Never the whole number: the person
 * signing in already knows it, and anyone else must not learn it.
 */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "••••";
}

export function phoneHint(e164: string): string {
  return e164.replace(/\D/g, "").slice(-4);
}
