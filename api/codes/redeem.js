import { createHmac } from 'node:crypto'
import { getDatabase } from '../_lib/db.js'
import { readJson, requireMethod, requireTrustedOrigin, sendJson } from '../_lib/http.js'
import { consumeRateLimit } from '../_lib/rate-limit.js'
import { getOrCreateSession } from '../_lib/session.js'

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST') || !requireTrustedOrigin(request, response)) return
  try {
    const sql = getDatabase()
    const session = await getOrCreateSession(request, response, sql)
    if (!(await consumeRateLimit(sql, request, 'redeem-code', session.accountId, 8, 300))) {
      return sendJson(response, 429, { error: 'Too many code attempts. Try again later.' })
    }
    const { code } = await readJson(request)
    const normalizedCode = String(code || '').trim()
    if (normalizedCode.length < 20 || normalizedCode.length > 128) {
      return sendJson(response, 400, { error: 'That code is invalid or unavailable.' })
    }
    const pepper = process.env.CODE_PEPPER || ''
    if (pepper.length < 32) throw new Error('CODE_PEPPER must contain at least 32 characters.')
    const codeHash = createHmac('sha256', pepper).update(normalizedCode).digest('hex')
    const rows = await sql`
      SELECT * FROM redeem_generation_code(${session.accountId}, ${codeHash})
    `
    sendJson(response, 200, {
      creditsAdded: Number(rows[0].credits_added),
      credits: Number(rows[0].credit_balance),
      alreadyRedeemed: rows[0].already_redeemed,
    })
  } catch (error) {
    if (error?.message?.includes('invalid_code')) {
      return sendJson(response, 400, { error: 'That code is invalid or unavailable.' })
    }
    console.error('Could not redeem generation code', error)
    sendJson(response, 500, { error: 'Could not redeem the generation code.' })
  }
}
