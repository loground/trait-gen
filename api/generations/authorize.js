import { readJson, requireMethod, requireTrustedOrigin, sendJson } from '../_lib/http.js'
import { getDatabase } from '../_lib/db.js'
import { consumeRateLimit } from '../_lib/rate-limit.js'
import { readSession } from '../_lib/session.js'

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST') || !requireTrustedOrigin(request, response)) return
  const session = await readSession(request)
  if (!session) return sendJson(response, 401, { error: 'Sign in with your wallet before generating.' })
  try {
    const sql = getDatabase()
    if (!(await consumeRateLimit(sql, request, 'authorize-generation', session.walletAddress, 30))) {
      return sendJson(response, 429, { error: 'Too many generation attempts. Try again shortly.' })
    }
    const { idempotencyKey } = await readJson(request)
    if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey || '')) return sendJson(response, 400, { error: 'A valid idempotency key is required.' })
    const rows = await sql`
      SELECT * FROM authorize_generation(${session.walletAddress}, ${idempotencyKey}::uuid)
    `
    sendJson(response, 200, {
      jobId: rows[0].job_id,
      credits: Number(rows[0].credit_balance),
      alreadyAuthorized: rows[0].already_authorized,
    })
  } catch (error) {
    if (error?.message?.includes('insufficient_credits')) {
      return sendJson(response, 402, { error: 'No generation credits remain.' })
    }
    console.error('Could not authorize generation', error)
    sendJson(response, 500, { error: 'Could not authorize this generation.' })
  }
}
