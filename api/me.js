import { getDatabase } from './_lib/db.js'
import { requireMethod, sendJson } from './_lib/http.js'
import { getOrCreateSession } from './_lib/session.js'

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'GET')) return
  try {
    const sql = getDatabase()
    const session = await getOrCreateSession(request, response, sql)
    const rows = await sql`
      SELECT credit_balance AS credits
      FROM wallet_accounts
      WHERE wallet_address = ${session.accountId}
    `
    sendJson(response, 200, {
      authenticated: true,
      credits: Number(rows[0]?.credits || 0),
    })
  } catch (error) {
    console.error('Could not load generation account', error)
    sendJson(response, 500, { error: 'Could not load generation credits.' })
  }
}
