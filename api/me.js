import { getDatabase } from './_lib/db.js'
import { requireMethod, sendJson } from './_lib/http.js'
import { readSession } from './_lib/session.js'

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'GET')) return
  const session = await readSession(request)
  if (!session) return sendJson(response, 401, { authenticated: false })
  try {
    const sql = getDatabase()
    const rows = await sql`
      SELECT credit_balance AS credits
      FROM wallet_accounts
      WHERE wallet_address = ${session.walletAddress}
    `
    sendJson(response, 200, {
      authenticated: true,
      walletAddress: session.walletAddress,
      credits: Number(rows[0]?.credits || 0),
    })
  } catch (error) {
    console.error('Could not load wallet account', error)
    sendJson(response, 500, { error: 'Could not load the wallet account.' })
  }
}
