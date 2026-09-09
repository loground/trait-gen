ALTER TABLE crypto_payment_quotes
  DROP CONSTRAINT IF EXISTS crypto_payment_quotes_credits_check;

UPDATE crypto_payment_quotes
SET credits = 4
WHERE referral_code IS NOT NULL
  AND status = 'pending';

ALTER TABLE crypto_payment_quotes
  ADD CONSTRAINT crypto_payment_quotes_credits_check
  CHECK (
    (referral_code IS NULL AND credits = 3)
    OR (referral_code IS NOT NULL AND credits IN (3, 4))
  );

DROP VIEW IF EXISTS referral_code_stats;

CREATE VIEW referral_code_stats AS
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
  COALESCE(SUM(quotes.credits) FILTER (WHERE quotes.status = 'claimed'), 0)::integer AS credits_granted,
  COALESCE(SUM(quotes.credits - 3) FILTER (WHERE quotes.status = 'claimed'), 0)::integer AS bonus_credits,
  (COUNT(quotes.id) FILTER (WHERE quotes.status = 'claimed') * 5)::integer AS discounts_usd,
  MAX(quotes.claimed_at) AS last_payment_at
FROM referral_codes codes
LEFT JOIN crypto_payment_quotes quotes
  ON quotes.referral_code = codes.referral_code
GROUP BY codes.referral_code;
