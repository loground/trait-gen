import { createHash } from 'node:crypto'
import { getRequestIp } from './http.js'

export async function consumeRateLimit(sql, request, scope, walletAddress, limit, windowSeconds = 60) {
  const identity = `${getRequestIp(request)}:${walletAddress || 'anonymous'}`
  const digest = createHash('sha256').update(identity).digest('hex')
  const bucketKey = `${scope}:${digest}`
  const rows = await sql`
    INSERT INTO api_rate_limits (bucket_key, window_started_at, request_count)
    VALUES (${bucketKey}, now(), 1)
    ON CONFLICT (bucket_key) DO UPDATE
    SET
      window_started_at = CASE
        WHEN api_rate_limits.window_started_at <= now() - (${windowSeconds} * interval '1 second') THEN now()
        ELSE api_rate_limits.window_started_at
      END,
      request_count = CASE
        WHEN api_rate_limits.window_started_at <= now() - (${windowSeconds} * interval '1 second') THEN 1
        ELSE api_rate_limits.request_count + 1
      END
    RETURNING request_count <= ${limit} AS allowed
  `
  return rows[0]?.allowed === true
}
