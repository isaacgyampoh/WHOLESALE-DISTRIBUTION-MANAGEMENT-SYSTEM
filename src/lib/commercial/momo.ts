/**
 * The mobile money networks, for both tills.
 *
 * Held in code rather than read from the database because the van till
 * has to work with no signal, and this list changes about once a decade.
 * The database has the same list in momo_providers and refuses anything
 * not on it, so the two cannot silently disagree.
 *
 * Shared so the van and the counter cannot drift apart either: a
 * reference is only matchable against a statement once you know whose
 * system issued it, and a network offered on one screen and missing
 * from the other is a payment somebody cannot record.
 */
export const MOMO_PROVIDERS = [
  { code: "mtn", short: "MTN" },
  { code: "telecel", short: "Telecel" },
  { code: "airteltigo", short: "AirtelTigo" },
] as const;

export type MomoProvider = (typeof MOMO_PROVIDERS)[number]["code"];
