import { createPublicClient, http } from 'viem'
import { verifyAndCreditBurn, BurnClaimError, ROBINHOOD_CHAIN_ID } from '../_lib/hoodchan-burn.js'
import { getDatabase } from '../_lib/db.js'
import { readJson, requireMethod, requireTrustedOrigin, sendJson } from '../_lib/http.js'
import { consumeRateLimit } from '../_lib/rate-limit.js'
import { readSession } from '../_lib/session.js'

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST') || !requireTrustedOrigin(request, response)) return
  const session = await readSession(request)
  if (!session) return sendJson(response, 401, { error: 'Connect and sign in with the wallet that owned the HOODCHAN.' })

  try {
    const sql = getDatabase()
    if (!(await consumeRateLimit(sql, request, 'claim-burn', session.walletAddress, 10))) {
      return sendJson(response, 429, { error: 'Too many burn claims. Try again shortly.' })
    }
    const { transactionHash } = await readJson(request)
    const hash = String(transactionHash || '').toLowerCase()
    if (!/^0x[0-9a-f]{64}$/.test(hash)) return sendJson(response, 400, { error: 'A valid burn transaction hash is required.' })

    const rpcUrl = process.env.ROBINHOOD_RPC_URL
    if (!rpcUrl) throw new Error('ROBINHOOD_RPC_URL is not configured.')
    const client = createPublicClient({ transport: http(rpcUrl) })
    if (await client.getChainId() !== ROBINHOOD_CHAIN_ID) throw new Error('The configured RPC is not Robinhood Chain mainnet.')

    const result = await verifyAndCreditBurn({ sql, client, walletAddress: session.walletAddress, transactionHash: hash })
    sendJson(response, 200, { success: true, ...result })
  } catch (error) {
    if (error instanceof BurnClaimError) return sendJson(response, error.status, { error: error.message })
    console.error('Could not verify HOODCHAN burn', error)
    sendJson(response, 500, { error: 'Could not verify the HOODCHAN burn.' })
  }
}
