import { createHmac, randomBytes } from 'node:crypto'
import { neon } from '@neondatabase/serverless'

const databaseUrl = process.env.DATABASE_URL || ''
const pepper = process.env.CODE_PEPPER || ''
if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (pepper.length < 32) throw new Error('CODE_PEPPER must contain at least 32 characters.')

const options = parseOptions(process.argv.slice(2))
const codes = Array.from({ length: options.count }, () => `TF-${randomBytes(24).toString('base64url')}`)
const records = codes.map((code) => ({
  code_hash: createHmac('sha256', pepper).update(code).digest('hex'),
  credits: options.credits,
  max_redemptions: options.uses,
  expires_at: options.expiresAt,
}))
const sql = neon(databaseUrl)
const rows = await sql`
  INSERT INTO access_codes (code_hash, credits, max_redemptions, expires_at)
  SELECT code_hash, credits, max_redemptions, expires_at
  FROM json_to_recordset(${JSON.stringify(records)}::json) AS batch(
    code_hash text,
    credits integer,
    max_redemptions integer,
    expires_at timestamptz
  )
  RETURNING id, code_hash, credits, max_redemptions, expires_at
`

const rowsByHash = new Map(rows.map((row) => [row.code_hash, row]))
console.log(JSON.stringify(codes.map((code, index) => {
  const row = rowsByHash.get(records[index].code_hash)
  return {
    code,
    id: row.id,
    credits: row.credits,
    maxRedemptions: row.max_redemptions,
    expiresAt: row.expires_at,
  }
}), null, 2))

function parseOptions(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) values.set(args[index], args[index + 1])
  const credits = Number(values.get('--credits') || 1)
  const uses = Number(values.get('--uses') || 1)
  const count = Number(values.get('--count') || 1)
  const expiresValue = values.get('--expires') || ''
  if (!Number.isInteger(credits) || credits < 1 || credits > 100) throw new Error('--credits must be an integer from 1 to 100.')
  if (!Number.isInteger(uses) || uses < 1 || uses > 10_000) throw new Error('--uses must be an integer from 1 to 10000.')
  if (!Number.isInteger(count) || count < 1 || count > 1_000) throw new Error('--count must be an integer from 1 to 1000.')
  const expiresAt = expiresValue ? new Date(expiresValue) : null
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error('--expires must be an ISO date.')
  return { count, credits, uses, expiresAt: expiresAt?.toISOString() || null }
}
