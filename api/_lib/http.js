import { getAppOrigin } from './config.js'

export function sendJson(response, status, payload) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

export function requireMethod(request, response, method) {
  if (request.method === method) return true
  response.setHeader('allow', method)
  sendJson(response, 405, { error: 'Method not allowed.' })
  return false
}

export function requireTrustedOrigin(request, response) {
  const origin = request.headers.origin
  const expectedOrigin = getAppOrigin()
  const developmentOrigin = process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '')
  if (origin === expectedOrigin || developmentOrigin) return true
  sendJson(response, 403, { error: 'Untrusted request origin.' })
  return false
}

export async function readJson(request) {
  if (request.body && typeof request.body === 'object') return request.body
  const chunks = []
  let totalBytes = 0
  for await (const chunk of request) {
    totalBytes += chunk.length
    if (totalBytes > 16_384) throw new Error('Request body is too large.')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function getRequestIp(request) {
  const forwarded = request.headers['x-forwarded-for']
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || request.socket?.remoteAddress || '')
    .split(',')[0]
    .trim()
    .slice(0, 96)
}
