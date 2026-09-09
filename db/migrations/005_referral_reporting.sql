CREATE OR REPLACE VIEW referral_code_stats AS
WITH referral_codes(referral_code) AS (
  VALUES ('ezzie'), ('ink'), ('filthy'), ('smolemaru')
)
SELECT
  codes.referral_code,
  COUNT(quotes.id)::integer AS quotes_created,
  COUNT(quotes.id) FILTER (WHERE quotes.status = 'claimed')::integer AS payments_completed,
  COALESCE(
    ROUND(
      COUNT(quotes.id) FILTER (WHERE quotes.status = 'claimed')::numeric
      / NULLIF(COUNT(quotes.id), 0)
      * 100,
      1
    ),
    0
  ) AS conversion_percent,
  COALESCE(
    ROUND(
      SUM(quotes.quoted_usd_micros) FILTER (WHERE quotes.status = 'claimed')::numeric
      / 1000000,
      2
    ),
    0
  ) AS revenue_usd,
  (COUNT(quotes.id) FILTER (WHERE quotes.status = 'claimed') * 5)::integer AS discounts_usd,
  MAX(quotes.claimed_at) AS last_payment_at
FROM referral_codes codes
LEFT JOIN crypto_payment_quotes quotes
  ON quotes.referral_code = codes.referral_code
GROUP BY codes.referral_code;
