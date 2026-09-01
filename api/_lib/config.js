const DEFAULT_APP_ORIGIN = 'https://www.trait-forge.art'
const DEFAULT_BASE_PAYMENT_ADDRESS = '0xc7a7ca7d3cfd3e8442c5a57a42a46fd655738276'

export function getAppOrigin() {
  return (process.env.APP_ORIGIN || DEFAULT_APP_ORIGIN).replace(/\/$/, '')
}

export function getSessionSecret() {
  const value = process.env.SESSION_SECRET || ''
  if (value.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.')
  return new TextEncoder().encode(value)
}

export function getDatabaseUrl() {
  const value = process.env.DATABASE_URL || ''
  if (!value) throw new Error('DATABASE_URL is not configured.')
  return value
}

export function getBasePaymentAddress() {
  const value = String(process.env.BASE_PAYMENT_ADDRESS || DEFAULT_BASE_PAYMENT_ADDRESS).trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(value)) throw new Error('BASE_PAYMENT_ADDRESS must be a valid Base address.')
  return value
}

export function getBaseRpcUrl() {
  return String(process.env.BASE_RPC_URL || 'https://mainnet.base.org').trim()
}

export function getMinUsdcConfirmations() {
  const value = Number(process.env.MIN_USDC_CONFIRMATIONS || 5)
  return Number.isInteger(value) && value >= 1 && value <= 100 ? BigInt(value) : 5n
}
