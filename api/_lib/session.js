import { randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { getSessionSecret } from './config.js'

const COOKIE_NAME = 'tf_session'
const SESSION_ISSUER = 'trait-forge'
const SESSION_AUDIENCE = 'trait-forge-web'
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30

export async function createSessionToken(accountId) {
  const normalizedAccountId = accountId.toLowerCase()
  return new SignJWT({ accountId: normalizedAccountId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(normalizedAccountId)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSessionSecret())
}

export async function readSession(request) {
  const token = parseCookies(request.headers.cookie || '')[COOKIE_NAME]
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      algorithms: ['HS256'],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    })
    const accountId = payload.sub || ''
    const walletAddress = /^0x[a-f0-9]{40}$/.test(accountId) ? accountId : null
    if (!walletAddress && !/^guest:[0-9a-f-]{36}$/.test(accountId)) return null
    return { accountId, walletAddress }
  } catch {
    return null
  }
}

export async function getOrCreateSession(request, response, sql) {
  const existing = await readSession(request)
  if (existing) return existing
  const accountId = `guest:${randomUUID()}`
  await sql`
    INSERT INTO wallet_accounts (wallet_address)
    VALUES (${accountId})
    ON CONFLICT (wallet_address) DO NOTHING
  `
  setSessionCookie(response, await createSessionToken(accountId))
  return { accountId, walletAddress: null }
}

export function setSessionCookie(response, token) {
  response.setHeader('set-cookie', serializeCookie(COOKIE_NAME, token, SESSION_DURATION_SECONDS))
}

export function clearSessionCookie(response) {
  response.setHeader('set-cookie', serializeCookie(COOKIE_NAME, '', 0))
}

function serializeCookie(name, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`
}

function parseCookies(header) {
  return header.split(';').reduce((cookies, part) => {
    const index = part.indexOf('=')
    if (index < 0) return cookies
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (name) cookies[name] = decodeURIComponent(value)
    return cookies
  }, {})
}
