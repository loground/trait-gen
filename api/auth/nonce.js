import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { getDatabase } from '../_lib/db.js'
import { getRequestIp, readJson, requireMethod, requireTrustedOrigin, sendJson } from '../_lib/http.js'

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST') || !requireTrustedOrigin(request, response)) return
  try {
    const { address } = await readJson(request)
    const walletAddress = String(address || '').toLowerCase()
    if (!/^0x[a-f0-9]{40}$/.test(walletAddress)) return sendJson(response, 400, { error: 'A valid wallet address is required.' })

    // EIP-4361 nonces must contain only alphanumeric characters.
    const nonce = randomBytes(16).toString('hex')
    const nonceId = randomUUID()
    const nonceHash = createHash('sha256').update(nonce).digest('hex')
    const sql = getDatabase()
    const requestIp = getRequestIp(request)
    const recentRequests = await sql`
      SELECT COUNT(*)::integer AS count
      FROM auth_nonces
      WHERE request_ip = ${requestIp}
        AND created_at > now() - interval '1 minute'
    `
    if (Number(recentRequests[0]?.count || 0) >= 10) {
      return sendJson(response, 429, { error: 'Too many login attempts. Try again shortly.' })
    }
    await sql`
      INSERT INTO auth_nonces (id, wallet_address, nonce_hash, request_ip, expires_at)
      VALUES (${nonceId}, ${walletAddress}, ${nonceHash}, ${requestIp}, now() + interval '10 minutes')
    `
    sendJson(response, 200, { nonce, nonceId, expiresInSeconds: 600 })
  } catch (error) {
    console.error('Could not issue wallet nonce', error)
    sendJson(response, 500, { error: 'Could not start wallet authentication.' })
  }
}
