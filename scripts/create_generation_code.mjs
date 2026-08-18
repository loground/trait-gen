import { createHmac, randomBytes } from 'node:crypto'
import { neon } from '@neondatabase/serverless'

const databaseUrl = process.env.DATABASE_URL || ''
const pepper = process.env.CODE_PEPPER || ''
if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (pepper.length < 32) throw new Error('CODE_PEPPER must contain at least 32 characters.')

const options = parseOptions(process.argv.slice(2))
const code = `TF-${randomBytes(24).toString('base64url')}`
const codeHash = createHmac('sha256', pepper).update(code).digest('hex')
const sql = neon(databaseUrl)
const rows = await sql`
  INSERT INTO access_codes (code_hash, credits, max_redemptions, expires_at)
  VALUES (${codeHash}, ${options.credits}, ${options.uses}, ${options.expiresAt})
  RETURNING id, credits, max_redemptions, expires_at
`

console.log(JSON.stringify({
  code,
  id: rows[0].id,
  credits: rows[0].credits,
  maxRedemptions: rows[0].max_redemptions,
  expiresAt: rows[0].expires_at,
}, null, 2))

function parseOptions(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) values.set(args[index], args[index + 1])
  const credits = Number(values.get('--credits') || 1)
  const uses = Number(values.get('--uses') || 1)
  const expiresValue = values.get('--expires') || ''
  if (!Number.isInteger(credits) || credits < 1 || credits > 100) throw new Error('--credits must be an integer from 1 to 100.')
  if (!Number.isInteger(uses) || uses < 1 || uses > 10_000) throw new Error('--uses must be an integer from 1 to 10000.')
  const expiresAt = expiresValue ? new Date(expiresValue) : null
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error('--expires must be an ISO date.')
  return { credits, uses, expiresAt: expiresAt?.toISOString() || null }
}
