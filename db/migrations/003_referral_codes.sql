ALTER TABLE crypto_payment_quotes
  DROP CONSTRAINT IF EXISTS crypto_payment_quotes_quoted_usd_micros_check;

ALTER TABLE crypto_payment_quotes
  ADD CONSTRAINT crypto_payment_quotes_quoted_usd_micros_check
  CHECK (quoted_usd_micros BETWEEN 14000000 AND 21000000);

ALTER TABLE crypto_payment_quotes
  ADD COLUMN IF NOT EXISTS referral_code text;

ALTER TABLE crypto_payment_quotes
  DROP CONSTRAINT IF EXISTS crypto_payment_quotes_referral_code_check;

ALTER TABLE crypto_payment_quotes
  ADD CONSTRAINT crypto_payment_quotes_referral_code_check
  CHECK (referral_code IS NULL OR referral_code IN ('ezzie', 'ink', 'filthy', 'smolemaru'));

CREATE INDEX IF NOT EXISTS crypto_payment_quotes_referral_idx
  ON crypto_payment_quotes (referral_code, created_at DESC)
  WHERE referral_code IS NOT NULL;
