/** Shared PIN rules. Safe on the client: contains no secret. */
export const PIN_LENGTH = 4;

const PIN_PATTERN = /^\d{4}$/;

/** Exactly four digits. Not three, not five, nothing but digits. */
export function isValidPinFormat(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/**
 * A handful of PINs are so common that allowing them undoes the point of
 * having one. Rejected when a PIN is chosen, never at sign-in - refusing
 * to accept a weak PIN at the door would tell an attacker which guesses
 * to skip.
 */
const TOO_OBVIOUS = new Set([
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "1234", "4321", "0123", "1212", "2020", "2021", "2022", "2023", "2024", "2025",
]);

export function isWeakPin(pin: string): boolean {
  return TOO_OBVIOUS.has(pin);
}
