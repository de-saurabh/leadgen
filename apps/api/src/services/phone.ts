/**
 * Turns whatever a person typed into the digits-only international form WhatsApp uses
 * (country code first, no `+`), or `null` when it can't be a phone number.
 * `defaultCountryCode` (digits, e.g. "91") is added to bare local numbers.
 */
export function normalizePhone(input: string, defaultCountryCode: string): string | null {
  const trimmed = input.trim();
  if (!/^[+(\d][\d\s().-]*$/.test(trimmed)) return null;

  const international = trimmed.startsWith('+') || trimmed.replace(/\D/g, '').startsWith('00');
  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  if (!international) {
    // A national trunk prefix (0) goes away; bare local numbers get the default country code.
    if (digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length <= 10) digits = defaultCountryCode + digits;
  }
  return digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0') ? digits : null;
}

/** Whether two normalized numbers are the same line, tolerating a missing country code. */
export function samePhone(a: string, b: string): boolean {
  return a === b || (a.length >= 10 && b.length >= 10 && a.slice(-10) === b.slice(-10));
}
