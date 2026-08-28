import { neon } from '@neondatabase/serverless'

const databaseUrl = process.env.DATABASE_URL || ''
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const sql = neon(databaseUrl)
const rows = await sql`
  SELECT
    referral_code,
    quotes_created,
    payments_completed,
    conversion_percent,
    revenue_usd,
    credits_granted,
    bonus_credits,
    discounts_usd,
    last_payment_at
  FROM referral_code_stats
  ORDER BY payments_completed DESC, quotes_created DESC, referral_code
`

console.table(rows.map((row) => ({
  source: row.referral_code,
  'quotes started': Number(row.quotes_created),
  'payments completed': Number(row.payments_completed),
  'conversion %': Number(row.conversion_percent),
  'revenue USD': Number(row.revenue_usd).toFixed(2),
  'credits granted': Number(row.credits_granted),
  'bonus credits': Number(row.bonus_credits),
  'discounts USD': Number(row.discounts_usd).toFixed(2),
  'last payment': row.last_payment_at ? new Date(row.last_payment_at).toISOString() : '—',
})))
