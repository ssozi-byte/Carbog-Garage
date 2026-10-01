/**
 * Kenyan phone normalization — accepts the formats customers actually type:
 *   0712345678 · +254712345678 · 254712345678 · 712345678 · +254 712 345 678
 * Returns canonical E.164 (+2547XXXXXXXX) or null when invalid.
 * Covers Safaricom/Airtel/Telkom mobile prefixes (7xx/1xx after country code).
 */
export function normalizeKenyanPhone(input: string | undefined | null): string | null {
  if (!input) return null
  let d = String(input).replace(/\D+/g, '')

  if (d.startsWith('254')) d = d.slice(3)
  else if (d.startsWith('0')) d = d.slice(1)

  // Valid KE mobile numbers are 9 digits starting 7 or 1
  if (d.length !== 9 || !/^[71]/.test(d)) return null
  return `+254${d}`
}

export function isValidKenyanPhone(input: string): boolean {
  return normalizeKenyanPhone(input) !== null
}
