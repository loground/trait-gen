import { readFile } from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'

const databaseUrl = process.env.DATABASE_URL || ''
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const migrationUrl = new URL('../db/migrations/001_credit_ledger.sql', import.meta.url)
const migration = await readFile(migrationUrl, 'utf8')
const sql = neon(databaseUrl)

const statements = splitSqlStatements(migration)
for (const statement of statements) await sql.query(statement)

const rows = await sql`
  SELECT COUNT(*)::integer AS table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'wallet_accounts', 'auth_nonces', 'api_rate_limits', 'credit_ledger',
      'burn_claims', 'generation_jobs', 'access_codes', 'code_redemptions'
    )
`

if (Number(rows[0]?.table_count) !== 8) {
  throw new Error(`Migration verification failed: expected 8 tables, found ${rows[0]?.table_count || 0}.`)
}

console.log('Migration complete: 8 credit-ledger tables verified.')

function splitSqlStatements(source) {
  const statements = []
  let current = ''
  let quote = null
  let dollarTag = null
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]

    if (lineComment) {
      current += character
      if (character === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      current += character
      if (character === '*' && next === '/') {
        current += next
        index += 1
        blockComment = false
      }
      continue
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        current += dollarTag
        index += dollarTag.length - 1
        dollarTag = null
      } else {
        current += character
      }
      continue
    }
    if (quote) {
      current += character
      if (character === quote) {
        if (next === quote) {
          current += next
          index += 1
        } else {
          quote = null
        }
      }
      continue
    }
    if (character === '-' && next === '-') {
      current += character + next
      index += 1
      lineComment = true
      continue
    }
    if (character === '/' && next === '*') {
      current += character + next
      index += 1
      blockComment = true
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      current += character
      continue
    }
    if (character === '$') {
      const match = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)
      if (match) {
        dollarTag = match[0]
        current += dollarTag
        index += dollarTag.length - 1
        continue
      }
    }
    if (character === ';') {
      if (current.trim()) statements.push(current.trim())
      current = ''
      continue
    }
    current += character
  }

  if (quote || dollarTag || blockComment) throw new Error('The SQL migration contains an unterminated block.')
  if (current.trim()) statements.push(current.trim())
  return statements
}
