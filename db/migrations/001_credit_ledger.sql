CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS wallet_accounts (
  wallet_address text PRIMARY KEY CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  credit_balance integer NOT NULL DEFAULT 0 CHECK (credit_balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  id uuid PRIMARY KEY,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  nonce_hash text NOT NULL UNIQUE,
  request_ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS auth_nonces_expiry_idx ON auth_nonces (expires_at);

CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0)
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wallet_address text NOT NULL REFERENCES wallet_accounts(wallet_address),
  delta integer NOT NULL CHECK (delta <> 0),
  event_type text NOT NULL CHECK (event_type IN ('hoodchan_burn', 'x402_payment', 'generation_code', 'generation')),
  event_reference text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_type, event_reference)
);

CREATE INDEX IF NOT EXISTS credit_ledger_wallet_idx ON credit_ledger (wallet_address, created_at DESC);

CREATE TABLE IF NOT EXISTS burn_claims (
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer NOT NULL CHECK (log_index >= 0),
  wallet_address text NOT NULL REFERENCES wallet_accounts(wallet_address),
  token_id numeric(78, 0) NOT NULL CHECK (token_id >= 0),
  block_number bigint NOT NULL CHECK (block_number >= 0),
  contract_address text NOT NULL CHECK (contract_address ~ '^0x[0-9a-f]{40}$'),
  credited_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_hash, log_index),
  UNIQUE (contract_address, token_id)
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL REFERENCES wallet_accounts(wallet_address),
  idempotency_key uuid NOT NULL,
  status text NOT NULL DEFAULT 'authorized' CHECK (status IN ('authorized', 'processing', 'ready', 'failed')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wallet_address, idempotency_key)
);

CREATE TABLE IF NOT EXISTS access_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  credits integer NOT NULL CHECK (credits > 0 AND credits <= 100),
  max_redemptions integer NOT NULL DEFAULT 1 CHECK (max_redemptions > 0),
  redemption_count integer NOT NULL DEFAULT 0 CHECK (redemption_count >= 0 AND redemption_count <= max_redemptions),
  expires_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS code_redemptions (
  code_id uuid NOT NULL REFERENCES access_codes(id),
  wallet_address text NOT NULL REFERENCES wallet_accounts(wallet_address),
  credits integer NOT NULL CHECK (credits > 0),
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code_id, wallet_address)
);

CREATE OR REPLACE FUNCTION authorize_generation(p_wallet_address text, p_idempotency_key uuid)
RETURNS TABLE (job_id uuid, credit_balance integer, already_authorized boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  existing_job generation_jobs%ROWTYPE;
  created_job_id uuid;
  remaining_credits integer;
BEGIN
  SELECT * INTO existing_job
  FROM generation_jobs
  WHERE wallet_address = p_wallet_address AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    SELECT account.credit_balance INTO remaining_credits
    FROM wallet_accounts account
    WHERE account.wallet_address = p_wallet_address;
    RETURN QUERY SELECT existing_job.id, remaining_credits, true;
    RETURN;
  END IF;

  UPDATE wallet_accounts
  SET credit_balance = wallet_accounts.credit_balance - 1
  WHERE wallet_address = p_wallet_address AND wallet_accounts.credit_balance >= 1
  RETURNING wallet_accounts.credit_balance INTO remaining_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient_credits' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO generation_jobs (wallet_address, idempotency_key)
  VALUES (p_wallet_address, p_idempotency_key)
  RETURNING id INTO created_job_id;

  INSERT INTO credit_ledger (wallet_address, delta, event_type, event_reference, metadata)
  VALUES (p_wallet_address, -1, 'generation', created_job_id::text, jsonb_build_object('idempotencyKey', p_idempotency_key));

  RETURN QUERY SELECT created_job_id, remaining_credits, false;
END;
$$;

CREATE OR REPLACE FUNCTION redeem_generation_code(p_wallet_address text, p_code_hash text)
RETURNS TABLE (credits_added integer, credit_balance integer, already_redeemed boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  selected_code access_codes%ROWTYPE;
  remaining_credits integer;
BEGIN
  SELECT * INTO selected_code
  FROM access_codes
  WHERE code_hash = p_code_hash
  FOR UPDATE;

  IF NOT FOUND OR selected_code.disabled_at IS NOT NULL OR (selected_code.expires_at IS NOT NULL AND selected_code.expires_at <= now()) THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM code_redemptions
    WHERE code_id = selected_code.id AND wallet_address = p_wallet_address
  ) THEN
    SELECT account.credit_balance INTO remaining_credits
    FROM wallet_accounts account WHERE account.wallet_address = p_wallet_address;
    RETURN QUERY SELECT 0, remaining_credits, true;
    RETURN;
  END IF;

  IF selected_code.redemption_count >= selected_code.max_redemptions THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE = 'P0001';
  END IF;

  UPDATE access_codes
  SET redemption_count = redemption_count + 1
  WHERE id = selected_code.id;

  INSERT INTO code_redemptions (code_id, wallet_address, credits)
  VALUES (selected_code.id, p_wallet_address, selected_code.credits);

  INSERT INTO credit_ledger (wallet_address, delta, event_type, event_reference, metadata)
  VALUES (
    p_wallet_address,
    selected_code.credits,
    'generation_code',
    selected_code.id::text || ':' || p_wallet_address,
    jsonb_build_object('codeId', selected_code.id)
  );

  UPDATE wallet_accounts
  SET credit_balance = wallet_accounts.credit_balance + selected_code.credits
  WHERE wallet_address = p_wallet_address
  RETURNING wallet_accounts.credit_balance INTO remaining_credits;

  RETURN QUERY SELECT selected_code.credits, remaining_credits, false;
END;
$$;
