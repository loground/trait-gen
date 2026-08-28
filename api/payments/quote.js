import { randomInt } from 'node:crypto'
import { createPublicClient, formatEther, http, parseAbi } from 'viem'
import { base } from 'viem/chains'
import { getBasePaymentAddress, getBaseRpcUrl } from '../_lib/config.js'
import { getDatabase } from '../_lib/db.js'
import { readJson, requireMethod, requireTrustedOrigin, sendJson } from '../_lib/http.js'
import { consumeRateLimit } from '../_lib/rate-limit.js'
import { isValidReferralCode, normalizeReferralCode, REFERRAL_DISCOUNT_USD_MICROS } from '../_lib/referrals.js'
import { getOrCreateSession } from '../_lib/session.js'

const BASE_CHAIN_ID = 8453
const BASE_USDC_ADDRESS = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const BASE_ETH_USD_FEED = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'
const PRICE_FEED_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
])
const QUOTE_DURATION_MINUTES = 60
const QUOTE_BASE_UNITS = 19_990_000
const QUOTE_SUFFIX_RANGE = 10_000

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST') || !requireTrustedOrigin(request, response)) return
  try {
    const sql = getDatabase()
    const session = await getOrCreateSession(request, response, sql)
    if (!(await consumeRateLimit(sql, request, 'create-payment-quote', session.accountId, 12, 3600))) {
      return sendJson(response, 429, { error: 'Too many payment requests. Try again later.' })
    }

    const recipientAddress = getBasePaymentAddress()
    const body = await readJson(request)
    const paymentAsset = String(body.asset || 'USDC').toUpperCase()
    if (!['USDC', 'ETH'].includes(paymentAsset)) return sendJson(response, 400, { error: 'Choose USDC or ETH.' })
    const submittedReferralCode = normalizeReferralCode(body.referralCode)
    if (submittedReferralCode && !isValidReferralCode(submittedReferralCode)) {
      return sendJson(response, 400, { error: 'That referral code is not valid.' })
    }
    const referralCode = submittedReferralCode || null
    const quoteBaseUnits = QUOTE_BASE_UNITS - (referralCode ? REFERRAL_DISCOUNT_USD_MICROS : 0)
    await sql`
      UPDATE crypto_payment_quotes
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at + interval '30 minutes' <= now()
    `

    let rows = await sql`
      SELECT id, amount_units, expires_at
      FROM crypto_payment_quotes
      WHERE wallet_address = ${session.accountId}
        AND payment_asset = ${paymentAsset}
        AND referral_code IS NOT DISTINCT FROM ${referralCode}
        AND status = 'pending'
        AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1
    `

    if (!rows.length) {
      for (let attempt = 0; attempt < 12 && !rows.length; attempt += 1) {
        const quotedUsdMicros = quoteBaseUnits + randomInt(1, QUOTE_SUFFIX_RANGE)
        const amountUnits = paymentAsset === 'USDC'
          ? BigInt(quotedUsdMicros)
          : await getEthAmountUnits(quotedUsdMicros)
        const tokenAddress = paymentAsset === 'USDC' ? BASE_USDC_ADDRESS : null
        rows = await sql`
          INSERT INTO crypto_payment_quotes (
            wallet_address, chain_id, payment_asset, token_address, recipient_address,
            amount_units, quoted_usd_micros, referral_code, credits, expires_at
          )
          VALUES (
            ${session.accountId}, ${BASE_CHAIN_ID}, ${paymentAsset}, ${tokenAddress}, ${recipientAddress},
            ${amountUnits.toString()}::bigint, ${quotedUsdMicros}, ${referralCode}, 3, now() + make_interval(mins => ${QUOTE_DURATION_MINUTES})
          )
          ON CONFLICT DO NOTHING
          RETURNING id, amount_units, expires_at
        `
      }
    }

    if (!rows.length) throw new Error('Could not reserve a unique payment amount.')
    const quote = rows[0]
    sendJson(response, 200, {
      quoteId: quote.id,
      network: 'Base',
      chainId: BASE_CHAIN_ID,
      asset: paymentAsset,
      tokenAddress: paymentAsset === 'USDC' ? BASE_USDC_ADDRESS : null,
      recipientAddress,
      amount: paymentAsset === 'USDC' ? formatUsdc(quote.amount_units) : formatEther(BigInt(quote.amount_units)),
      amountUnits: String(quote.amount_units),
      credits: 3,
      referralCode,
      discountUsd: referralCode ? 5 : 0,
      expiresAt: new Date(quote.expires_at).toISOString(),
      explorerUrl: 'https://base.blockscout.com',
    })
  } catch (error) {
    console.error('Could not create crypto payment quote', error)
    sendJson(response, 500, { error: 'Could not prepare the crypto payment. Please try again.' })
  }
}

async function getEthAmountUnits(quotedUsdMicros) {
  const client = createPublicClient({ chain: base, transport: http(getBaseRpcUrl(), { timeout: 12_000 }) })
  const [decimals, round] = await Promise.all([
    client.readContract({ address: BASE_ETH_USD_FEED, abi: PRICE_FEED_ABI, functionName: 'decimals' }),
    client.readContract({ address: BASE_ETH_USD_FEED, abi: PRICE_FEED_ABI, functionName: 'latestRoundData' }),
  ])
  const [roundId, answer, , updatedAt, answeredInRound] = round
  if (answer <= 0n || updatedAt === 0n || answeredInRound < roundId) throw new Error('The ETH/USD price is unavailable.')
  if (Date.now() / 1000 - Number(updatedAt) > 2 * 60 * 60) throw new Error('The ETH/USD price is too old.')
  const numerator = BigInt(quotedUsdMicros) * 10n ** (18n + BigInt(decimals))
  const denominator = 1_000_000n * answer
  return (numerator + denominator - 1n) / denominator
}

function formatUsdc(value) {
  const units = BigInt(value)
  const whole = units / 1_000_000n
  const fraction = String(units % 1_000_000n).padStart(6, '0')
  return `${whole}.${fraction}`
}
