import { randomBytes } from 'node:crypto'
import { importJWK, importPKCS8, SignJWT } from 'jose'

export function createCdpAuthHeaders(apiKeyId, apiKeySecret, facilitatorUrl) {
  const url = new URL(facilitatorUrl)
  const basePath = url.pathname.replace(/\/$/, '')
  const correlation = 'sdk_language=typescript,source=trait-forge'

  return async () => ({
    verify: {
      Authorization: `Bearer ${await generateCdpJwt(apiKeyId, apiKeySecret, 'POST', url.host, `${basePath}/verify`)}`,
      'Correlation-Context': correlation,
    },
    settle: {
      Authorization: `Bearer ${await generateCdpJwt(apiKeyId, apiKeySecret, 'POST', url.host, `${basePath}/settle`)}`,
      'Correlation-Context': correlation,
    },
    supported: {
      Authorization: `Bearer ${await generateCdpJwt(apiKeyId, apiKeySecret, 'GET', url.host, `${basePath}/supported`)}`,
      'Correlation-Context': correlation,
    },
  })
}

async function generateCdpJwt(apiKeyId, apiKeySecret, method, host, path) {
  const now = Math.floor(Date.now() / 1000)
  const nonce = randomBytes(16).toString('hex')
  const jwt = new SignJWT({
    sub: apiKeyId,
    iss: 'cdp',
    uris: [`${method} ${host}${path}`],
  }).setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 120)

  if (apiKeySecret.includes('BEGIN PRIVATE KEY')) {
    const key = await importPKCS8(apiKeySecret.replace(/\\n/g, '\n'), 'ES256')
    return jwt.setProtectedHeader({ alg: 'ES256', kid: apiKeyId, typ: 'JWT', nonce }).sign(key)
  }

  const decoded = Buffer.from(apiKeySecret, 'base64')
  if (decoded.length !== 64) throw new Error('CDP_API_KEY_SECRET has an unsupported key format.')
  const key = await importJWK({
    kty: 'OKP',
    crv: 'Ed25519',
    d: decoded.subarray(0, 32).toString('base64url'),
    x: decoded.subarray(32).toString('base64url'),
  }, 'EdDSA')
  return jwt.setProtectedHeader({ alg: 'EdDSA', kid: apiKeyId, typ: 'JWT', nonce }).sign(key)
}
