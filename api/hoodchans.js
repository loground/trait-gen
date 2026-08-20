import { getDatabase } from './_lib/db.js'
import { consumeRateLimit } from './_lib/rate-limit.js'
import { requireMethod, sendJson } from './_lib/http.js'
import { readSession } from './_lib/session.js'
import { createPublicClient, http } from 'viem'

const HOODCHAN_CONTRACT_ADDRESS = '0x774db2207d26570f5638028839c816702a40abc2'
const BLOCKSCOUT_API = 'https://robinhoodchain.blockscout.com/api/v2'
const OWNER_OF_ABI = [{
  type: 'function',
  name: 'ownerOf',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: 'owner', type: 'address' }],
}]

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'GET')) return
  const session = await readSession(request)
  if (!session) return sendJson(response, 401, { error: 'Connect your Robinhood-compatible wallet first.' })

  try {
    const sql = getDatabase()
    if (!(await consumeRateLimit(sql, request, 'list-hoodchans', session.walletAddress, 20, 300))) {
      return sendJson(response, 429, { error: 'Too many collection refreshes. Try again shortly.' })
    }

    const items = []
    const seen = new Set()
    let pageParams = {}
    for (let page = 0; page < 30; page += 1) {
      const url = new URL(`${BLOCKSCOUT_API}/addresses/${session.walletAddress}/nft`)
      url.searchParams.set('type', 'ERC-721')
      for (const [key, value] of Object.entries(pageParams)) url.searchParams.set(key, String(value))

      const explorerResponse = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!explorerResponse.ok) throw new Error(`Blockscout returned ${explorerResponse.status}.`)
      const result = await explorerResponse.json()

      for (const nft of result.items || []) {
        if (nft.token?.address_hash?.toLowerCase() !== HOODCHAN_CONTRACT_ADDRESS) continue
        const tokenId = String(nft.id || '')
        if (!/^\d+$/.test(tokenId) || seen.has(tokenId)) continue
        seen.add(tokenId)
        items.push({
          tokenId,
          name: nft.metadata?.name || `HOODCHAN #${tokenId}`,
          imageUrl: `/api/hoodchan-image?tokenId=${encodeURIComponent(tokenId)}`,
        })
      }

      if (!result.next_page_params) break
      pageParams = result.next_page_params
    }

    const rpcUrl = process.env.ROBINHOOD_RPC_URL
    if (!rpcUrl) throw new Error('ROBINHOOD_RPC_URL is not configured.')
    const client = createPublicClient({ transport: http(rpcUrl) })
    const verifiedItems = await verifyOwnership(client, items, session.walletAddress)

    verifiedItems.sort((first, second) => Number(second.tokenId) - Number(first.tokenId))
    sendJson(response, 200, {
      walletAddress: session.walletAddress,
      network: { name: 'Robinhood Chain', chainId: 4663 },
      items: verifiedItems,
    })
  } catch (error) {
    console.error('Could not load owned HOODCHANs', error)
    sendJson(response, 502, { error: 'Could not load HOODCHANs from the Robinhood Chain explorer.' })
  }
}

async function verifyOwnership(client, items, walletAddress) {
  const verified = []
  const expectedOwner = walletAddress.toLowerCase()
  for (let offset = 0; offset < items.length; offset += 20) {
    const batch = items.slice(offset, offset + 20)
    const owners = await Promise.all(batch.map(async (item) => {
      try {
        return await client.readContract({
          address: HOODCHAN_CONTRACT_ADDRESS,
          abi: OWNER_OF_ABI,
          functionName: 'ownerOf',
          args: [BigInt(item.tokenId)],
        })
      } catch {
        return null
      }
    }))
    batch.forEach((item, index) => {
      if (owners[index]?.toLowerCase() === expectedOwner) verified.push(item)
    })
  }
  return verified
}
