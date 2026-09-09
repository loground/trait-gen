import { createPublicClient, http } from 'viem'
import { BurnClaimError, HOODCHAN_CONTRACT_ADDRESS, ROBINHOOD_CHAIN_ID, verifyAndCreditBurn } from '../_lib/hoodchan-burn.js'
import { getDatabase } from '../_lib/db.js'
import { requireMethod, requireTrustedOrigin, sendJson } from '../_lib/http.js'
import { consumeRateLimit } from '../_lib/rate-limit.js'
import { readSession } from '../_lib/session.js'

const BLOCKSCOUT_API = 'https://robinhoodchain.blockscout.com/api/v2'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST') || !requireTrustedOrigin(request, response)) return
  const session = await readSession(request)
  if (!session) return sendJson(response, 401, { error: 'Connect and sign in with the wallet that burned the HOODCHAN.' })

  try {
    const sql = getDatabase()
    if (!(await consumeRateLimit(sql, request, 'recover-burns', session.walletAddress, 6, 300))) {
      return sendJson(response, 429, { error: 'Too many recovery checks. Try again shortly.' })
    }
    const rpcUrl = process.env.ROBINHOOD_RPC_URL
    if (!rpcUrl) throw new Error('ROBINHOOD_RPC_URL is not configured.')
    const client = createPublicClient({ transport: http(rpcUrl) })
    if (await client.getChainId() !== ROBINHOOD_CHAIN_ID) throw new Error('The configured RPC is not Robinhood Chain mainnet.')

    const hashes = await findRecentBurnHashes(session.walletAddress)
    const claims = []
    for (const transactionHash of hashes) {
      try {
        claims.push(await verifyAndCreditBurn({ sql, client, walletAddress: session.walletAddress, transactionHash }))
      } catch (error) {
        if (!(error instanceof BurnClaimError) || ![404, 409].includes(error.status)) throw error
      }
    }
    const account = await sql`
      SELECT credit_balance FROM wallet_accounts WHERE wallet_address = ${session.walletAddress}
    `
    sendJson(response, 200, {
      success: true,
      credits: Number(account[0]?.credit_balance || 0),
      creditsAdded: claims.reduce((total, claim) => total + claim.creditsAdded, 0),
      recovered: claims.filter((claim) => !claim.alreadyCredited),
    })
  } catch (error) {
    console.error('Could not recover HOODCHAN burns', error)
    sendJson(response, 500, { error: 'Could not recover previous HOODCHAN burns.' })
  }
}

async function findRecentBurnHashes(walletAddress) {
  const hashes = []
  let pageParams = {}
  for (let page = 0; page < 5; page += 1) {
    const url = new URL(`${BLOCKSCOUT_API}/addresses/${walletAddress}/token-transfers`)
    url.searchParams.set('type', 'ERC-721')
    for (const [key, value] of Object.entries(pageParams)) url.searchParams.set(key, String(value))
    const explorerResponse = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!explorerResponse.ok) throw new Error(`Blockscout returned ${explorerResponse.status}.`)
    const result = await explorerResponse.json()
    for (const transfer of result.items || []) {
      if (transfer.token?.address_hash?.toLowerCase() !== HOODCHAN_CONTRACT_ADDRESS) continue
      if (transfer.from?.hash?.toLowerCase() !== walletAddress) continue
      if (transfer.to?.hash?.toLowerCase() !== ZERO_ADDRESS) continue
      const hash = String(transfer.transaction_hash || '').toLowerCase()
      if (/^0x[0-9a-f]{64}$/.test(hash) && !hashes.includes(hash)) hashes.push(hash)
    }
    if (!result.next_page_params) break
    pageParams = result.next_page_params
  }
  return hashes
}
