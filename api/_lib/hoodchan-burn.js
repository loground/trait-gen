import { decodeEventLog } from 'viem'

export const HOODCHAN_CONTRACT_ADDRESS = '0x774db2207d26570f5638028839c816702a40abc2'
export const ROBINHOOD_CHAIN_ID = 4663
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const TRANSFER_EVENT = [{
  type: 'event',
  name: 'Transfer',
  inputs: [
    { indexed: true, name: 'from', type: 'address' },
    { indexed: true, name: 'to', type: 'address' },
    { indexed: true, name: 'tokenId', type: 'uint256' },
  ],
}]

export class BurnClaimError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'BurnClaimError'
    this.status = status
  }
}

export async function verifyAndCreditBurn({ sql, client, walletAddress, transactionHash }) {
  let receipt
  try {
    receipt = await client.getTransactionReceipt({ hash: transactionHash })
  } catch (error) {
    if (error?.name === 'TransactionReceiptNotFoundError') throw new BurnClaimError(404, 'The burn transaction was not found yet.')
    throw error
  }
  if (receipt.status !== 'success') throw new BurnClaimError(422, 'The burn transaction did not succeed.')
  if (receipt.to?.toLowerCase() !== HOODCHAN_CONTRACT_ADDRESS) {
    throw new BurnClaimError(422, 'That transaction did not call the HOODCHAN contract.')
  }

  const burn = findWalletBurn(receipt.logs, walletAddress)
  if (!burn) throw new BurnClaimError(422, 'No matching HOODCHAN burn from this wallet was found.')
  if (!(await isReceiptFinal(client, receipt))) {
    throw new BurnClaimError(409, 'The burn is confirmed and is waiting for additional chain confirmations.')
  }

  const eventReference = `${ROBINHOOD_CHAIN_ID}:${transactionHash}:${burn.logIndex}`
  const metadata = JSON.stringify({
    transactionHash,
    tokenId: burn.tokenId.toString(),
    blockNumber: receipt.blockNumber.toString(),
  })
  const credited = await sql`
    WITH new_claim AS (
      INSERT INTO burn_claims (
        transaction_hash, log_index, wallet_address, token_id, block_number, contract_address
      )
      VALUES (
        ${transactionHash}, ${burn.logIndex}, ${walletAddress}, ${burn.tokenId.toString()},
        ${receipt.blockNumber.toString()}, ${HOODCHAN_CONTRACT_ADDRESS}
      )
      ON CONFLICT DO NOTHING
      RETURNING transaction_hash
    ), new_ledger_entry AS (
      INSERT INTO credit_ledger (wallet_address, delta, event_type, event_reference, metadata)
      SELECT ${walletAddress}, 3, 'hoodchan_burn', ${eventReference}, ${metadata}::jsonb
      FROM new_claim
      RETURNING id
    )
    UPDATE wallet_accounts
    SET credit_balance = wallet_accounts.credit_balance + 3
    WHERE wallet_address = ${walletAddress}
      AND EXISTS (SELECT 1 FROM new_ledger_entry)
    RETURNING credit_balance
  `

  if (credited.length) {
    return {
      creditsAdded: 3,
      credits: Number(credited[0].credit_balance),
      tokenId: burn.tokenId.toString(),
      transactionHash,
      alreadyCredited: false,
    }
  }

  const existing = await sql`
    SELECT wa.credit_balance
    FROM burn_claims bc
    JOIN wallet_accounts wa ON wa.wallet_address = bc.wallet_address
    WHERE bc.transaction_hash = ${transactionHash}
      AND bc.log_index = ${burn.logIndex}
      AND bc.wallet_address = ${walletAddress}
    LIMIT 1
  `
  if (!existing.length) throw new BurnClaimError(409, 'This token burn conflicts with a previously credited claim.')
  return {
    creditsAdded: 0,
    credits: Number(existing[0].credit_balance),
    tokenId: burn.tokenId.toString(),
    transactionHash,
    alreadyCredited: true,
  }
}

function findWalletBurn(logs, walletAddress) {
  for (const log of logs) {
    if (log.address.toLowerCase() !== HOODCHAN_CONTRACT_ADDRESS) continue
    try {
      const decoded = decodeEventLog({ abi: TRANSFER_EVENT, data: log.data, topics: log.topics })
      if (
        decoded.eventName === 'Transfer'
        && decoded.args.from.toLowerCase() === walletAddress
        && decoded.args.to.toLowerCase() === ZERO_ADDRESS
      ) {
        return { tokenId: decoded.args.tokenId, logIndex: log.logIndex }
      }
    } catch {
      // Ignore unrelated logs emitted by the transaction.
    }
  }
  return null
}

async function isReceiptFinal(client, receipt) {
  const latestBlockNumber = await client.getBlockNumber()
  const minimumConfirmations = BigInt(Math.max(2, Number(process.env.MIN_BURN_CONFIRMATIONS) || 20))
  const confirmations = latestBlockNumber >= receipt.blockNumber
    ? latestBlockNumber - receipt.blockNumber + 1n
    : 0n
  if (confirmations < minimumConfirmations) return false

  const canonicalBlock = await client.getBlock({ blockNumber: receipt.blockNumber })
  return canonicalBlock.hash.toLowerCase() === receipt.blockHash.toLowerCase()
}
