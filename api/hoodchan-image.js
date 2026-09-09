import { requireMethod } from './_lib/http.js'

const HOODCHAN_CONTRACT_ADDRESS = '0x774db2207d26570f5638028839c816702a40abc2'
const HOODCHAN_PREVIEW_CID = 'bafybeif7ihfk4vwja7gjelbhxojchzvk756xayqucramjaz6knujwujrdu'
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'GET')) return
  const tokenId = new URL(request.url, 'https://www.trait-forge.art').searchParams.get('tokenId') || ''
  if (!/^\d{1,6}$/.test(tokenId)) return sendImageError(response, 400, 'A valid token ID is required.')

  const openSeaImage = await findOpenSeaImage(tokenId)
  const sources = [
    openSeaImage,
    `https://gateway.pinata.cloud/ipfs/${HOODCHAN_PREVIEW_CID}`,
  ].filter(Boolean)

  for (const source of sources) {
    try {
      const upstream = await fetch(source, {
        headers: { accept: 'image/avif,image/webp,image/gif,image/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      })
      const contentType = upstream.headers.get('content-type') || ''
      if (!upstream.ok || !contentType.toLowerCase().startsWith('image/')) continue
      const bytes = await upstream.arrayBuffer()
      if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) continue

      response.statusCode = 200
      response.setHeader('content-type', contentType)
      response.setHeader('content-length', String(bytes.byteLength))
      response.setHeader('cache-control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=2592000')
      response.setHeader('x-content-type-options', 'nosniff')
      response.end(Buffer.from(bytes))
      return
    } catch {
      // Try the collection preview only when OpenSea media is unavailable.
    }
  }

  sendImageError(response, 502, 'HOODCHAN artwork is temporarily unavailable.')
}

async function findOpenSeaImage(tokenId) {
  try {
    const itemUrl = `https://opensea.io/item/robinhood/${HOODCHAN_CONTRACT_ADDRESS}/${tokenId}`
    const itemResponse = await fetch(itemUrl, {
      headers: {
        accept: 'text/html',
        'user-agent': 'TraitForge/1.0 NFT artwork resolver',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!itemResponse.ok) return ''
    const html = await itemResponse.text()
    const escapedContract = HOODCHAN_CONTRACT_ADDRESS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = html.match(new RegExp(`https://i2c?\\.seadn\\.io/robinhood/${escapedContract}/[^"\\\\< ]+`, 'i'))
    return match?.[0]?.replace(/&amp;/g, '&') || ''
  } catch {
    return ''
  }
}

function sendImageError(response, status, message) {
  response.statusCode = status
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(message)
}
