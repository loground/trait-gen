export const REFERRAL_DISCOUNT_USD_MICROS = 5_000_000

const REFERRAL_CODES = new Set([
  'ezzie',
  'ink',
  'filthy',
  'smolemaru',
])

export function normalizeReferralCode(value) {
  return String(value || '').trim().toLowerCase()
}

export function isValidReferralCode(value) {
  return REFERRAL_CODES.has(normalizeReferralCode(value))
}
