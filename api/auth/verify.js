import { createHash } from 'node:crypto'
import { SiweMessage } from 'siwe'
import { getAppOrigin } from '../_lib/config.js'
import { getDatabase } from '../_lib/db.js'
import { readJson, requireMethod, requireTrustedOrigin, sendJson } from '../_lib/http.js'
import { consumeRateLimit } from '../_lib/rate-limit.js'
import { createSessionToken, setSessionCookie } from '../_lib/session.js'

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST') || !requireTrustedOrigin(request, response)) return
  try {
    const { message, signature, nonceId } = await readJson(request)
    if (!message || !signature || !/^[0-9a-f-]{36}$/i.test(nonceId || '')) {
      return sendJson(response, 400, { error: 'The authentication request is incomplete.' })
    }

    const siweMessage = new SiweMessage(message)
    const walletAddress = siweMessage.address.toLowerCase()
    const sql = getDatabase()
    if (!(await consumeRateLimit(sql, request, 'verify-login', walletAddress, 15, 300))) {
      return sendJson(response, 429, { error: 'Too many wallet verification attempts. Try again later.' })
    }
    const expectedOrigin = new URL(getAppOrigin())
    const developmentHost = process.env.NODE_ENV !== 'production' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(siweMessage.domain)
    if (siweMessage.domain !== expectedOrigin.host && !developmentHost) {
      return sendJson(response, 400, { error: 'The signed message belongs to another domain.' })
    }
    const messageUri = new URL(siweMessage.uri)
    const validMessageUri = developmentHost
      ? messageUri.host === siweMessage.domain && ['http:', 'https:'].includes(messageUri.protocol)
      : messageUri.origin === expectedOrigin.origin
    if (!validMessageUri) {
      return sendJson(response, 400, { error: 'The signed message has an invalid URI.' })
    }

    const verification = await siweMessage.verify({
      signature,
      nonce: siweMessage.nonce,
      domain: siweMessage.domain,
      time: new Date().toISOString(),
    })
    if (!verification.success) return sendJson(response, 401, { error: 'The wallet signature is invalid.' })

    const nonceHash = createHash('sha256').update(siweMessage.nonce).digest('hex')
    const consumed = await sql`
      UPDATE auth_nonces
      SET consumed_at = now()
      WHERE id = ${nonceId}
        AND wallet_address = ${walletAddress}
        AND nonce_hash = ${nonceHash}
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING id
    `
    if (!consumed.length) return sendJson(response, 401, { error: 'This login request expired or was already used.' })

    await sql`
      INSERT INTO wallet_accounts (wallet_address)
      VALUES (${walletAddress})
      ON CONFLICT (wallet_address) DO UPDATE SET last_login_at = now()
    `
    const token = await createSessionToken(walletAddress)
    setSessionCookie(response, token)
    sendJson(response, 200, { walletAddress })
  } catch (error) {
    console.error('Could not verify wallet login', error)
    sendJson(response, 401, { error: 'Could not verify the wallet login.' })
  }
}
