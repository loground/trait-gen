import { createPublicClient, decodeEventLog, http, parseAbiItem } from 'viem'
import { base } from 'viem/chains'
import { getBaseRpcUrl, getMinUsdcConfirmations } from '../_lib/config.js'
import { getDatabase } from '../_lib/db.js'
import { readJson, requireMethod, requireTrustedOrigin, sendJson } from '../_lib/http.js'
import { consumeRateLimit } from '../_lib/rate-limit.js'
import { getOrCreateSession } from '../_lib/session.js'

const BASE_USDC_ADDRESS = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

export default async function handler(request, response) {
  if (!requireMethod(request, response, 'POST') || !requireTrustedOrigin(request, response)) return
  try {
    const sql = getDatabase()
    const session = await getOrCreateSession(request, response, sql)
    if (!(await consumeRateLimit(sql, request, 'claim-usdc-payment', session.accountId, 12, 300))) {
      return sendJson(response, 429, { error: 'Too many payment checks. Wait a few minutes and try again.' })
    }

    const { quoteId, transaction } = await readJson(request)
    if (!/^[0-9a-f-]{36}$/i.test(quoteId || '')) return sendJson(response, 400, { error: 'Start a new payment before checking the transaction.' })
    const transactionHash = extractTransactionHash(transaction)
    if (!transactionHash) return sendJson(response, 400, { error: 'Paste a valid Base transaction hash or explorer link.' })

    const quoteRows = await sql`
      SELECT id, payment_asset, amount_units, token_address, recipient_address, status, transaction_hash, created_at, expires_at
      FROM crypto_payment_quotes
      WHERE id = ${quoteId}::uuid AND wallet_address = ${session.accountId}
      LIMIT 1
    `
    const quote = quoteRows[0]
    if (!quote) return sendJson(response, 404, { error: 'That payment request does not belong to this browser.' })
    if (quote.status === 'claimed' && quote.transaction_hash === transactionHash) {
      const accountRows = await sql`SELECT credit_balance FROM wallet_accounts WHERE wallet_address = ${session.accountId}`
      return sendJson(response, 200, { creditsAdded: 0, credits: Number(accountRows[0]?.credit_balance || 0), alreadyClaimed: true })
    }
    if (quote.status !== 'pending') return sendJson(response, 409, { error: 'This payment request is no longer active. Start a new one.' })

    const client = createPublicClient({ chain: base, transport: http(getBaseRpcUrl(), { timeout: 12_000 }) })
    let receipt
    try {
      receipt = await client.getTransactionReceipt({ hash: transactionHash })
    } catch (error) {
      if (error?.name === 'TransactionReceiptNotFoundError') {
        return sendJson(response, 404, { error: 'Transaction not found yet. Wait for it to confirm on Base, then try again.' })
      }
      throw error
    }
    if (receipt.status !== 'success') return sendJson(response, 422, { error: 'That transaction did not succeed.' })

    const latestBlock = await client.getBlockNumber()
    const minimumConfirmations = getMinUsdcConfirmations()
    const confirmations = latestBlock >= receipt.blockNumber ? latestBlock - receipt.blockNumber + 1n : 0n
    if (confirmations < minimumConfirmations) {
      return sendJson(response, 409, { error: `Payment found. Wait for ${Number(minimumConfirmations - confirmations)} more Base confirmation${minimumConfirmations - confirmations === 1n ? '' : 's'}.` })
    }

    let payerAddress = ''
    if (quote.payment_asset === 'USDC') {
      const transfers = receipt.logs.flatMap((log) => {
        if (log.address.toLowerCase() !== BASE_USDC_ADDRESS) return []
        try {
          const decoded = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics, strict: true })
          return decoded.eventName === 'Transfer' ? [decoded.args] : []
        } catch {
          return []
        }
      }).filter((transfer) => transfer.to.toLowerCase() === quote.recipient_address)
      const paidUnits = transfers.reduce((total, transfer) => total + transfer.value, 0n)
      if (paidUnits !== BigInt(quote.amount_units)) {
        return sendJson(response, 422, { error: 'This transaction did not send the exact quoted USDC amount to the payment address.' })
      }
      payerAddress = transfers[0]?.from?.toLowerCase() || receipt.from?.toLowerCase()
    } else if (quote.payment_asset === 'ETH') {
      const transaction = await client.getTransaction({ hash: transactionHash })
      if (transaction.to?.toLowerCase() !== quote.recipient_address || transaction.value !== BigInt(quote.amount_units)) {
        return sendJson(response, 422, { error: 'This transaction did not send the exact quoted ETH amount to the payment address.' })
      }
      payerAddress = transaction.from.toLowerCase()
    } else {
      return sendJson(response, 422, { error: 'This payment request uses an unsupported asset.' })
    }

    const paymentBlock = await client.getBlock({ blockNumber: receipt.blockNumber })
    const paymentTime = Number(paymentBlock.timestamp) * 1000
    const earliestTime = new Date(quote.created_at).getTime() - 120_000
    const latestTime = new Date(quote.expires_at).getTime() + 120_000
    if (paymentTime < earliestTime || paymentTime > latestTime) {
      return sendJson(response, 422, { error: 'The payment was not made during this payment request.' })
    }

    if (!payerAddress) return sendJson(response, 422, { error: 'Could not identify the payment sender in this transaction.' })
    const rows = await sql`
      SELECT * FROM claim_crypto_payment(
        ${quote.id}::uuid,
        ${session.accountId},
        ${transactionHash},
        ${receipt.blockNumber.toString()}::bigint,
        ${payerAddress}
      )
    `
    sendJson(response, 200, {
      creditsAdded: Number(rows[0].credits_added),
      credits: Number(rows[0].credit_balance),
      alreadyClaimed: rows[0].already_claimed,
      transactionHash,
    })
  } catch (error) {
    const message = String(error?.message || '')
    if (error?.code === '23505') return sendJson(response, 409, { error: 'This transaction has already been used.' })
    if (message.includes('payment_already_claimed')) return sendJson(response, 409, { error: 'This transaction has already been used.' })
    if (message.includes('payment_quote_expired')) return sendJson(response, 409, { error: 'This payment request expired. Start a new one.' })
    if (message.includes('payment_quote_already_claimed')) return sendJson(response, 409, { error: 'This payment request has already been used.' })
    if (message.includes('invalid_payment_quote')) return sendJson(response, 404, { error: 'Payment request not found.' })
    console.error('Could not verify crypto payment', error)
    sendJson(response, 500, { error: 'Could not verify the Base payment. Please try again.' })
  }
}

function extractTransactionHash(value) {
  const match = String(value || '').trim().toLowerCase().match(/0x[0-9a-f]{64}/)
  return match?.[0] || ''
}
