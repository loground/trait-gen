const DEFAULT_APP_ORIGIN = 'https://www.trait-forge.art'

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
