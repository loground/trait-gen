import { SignJWT, jwtVerify } from 'jose'
import { getSessionSecret } from './config.js'

const COOKIE_NAME = 'tf_session'
const SESSION_ISSUER = 'trait-forge'
const SESSION_AUDIENCE = 'trait-forge-web'
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30

export async function createSessionToken(walletAddress) {
  return new SignJWT({ wallet: walletAddress.toLowerCase() })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(walletAddress.toLowerCase())
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
    if (!/^0x[a-f0-9]{40}$/.test(payload.sub || '')) return null
    return { walletAddress: payload.sub }
  } catch {
    return null
  }
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
