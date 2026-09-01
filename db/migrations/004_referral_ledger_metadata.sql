CREATE OR REPLACE FUNCTION claim_crypto_payment(
  p_quote_id uuid,
  p_wallet_address text,
  p_transaction_hash text,
  p_transaction_block bigint,
  p_payer_address text
)
RETURNS TABLE (credits_added integer, credit_balance integer, already_claimed boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  selected_quote crypto_payment_quotes%ROWTYPE;
  remaining_credits integer;
BEGIN
  SELECT * INTO selected_quote
  FROM crypto_payment_quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND OR selected_quote.wallet_address <> p_wallet_address THEN
    RAISE EXCEPTION 'invalid_payment_quote' USING ERRCODE = 'P0001';
  END IF;

  IF selected_quote.status = 'claimed' THEN
    IF selected_quote.transaction_hash <> p_transaction_hash THEN
      RAISE EXCEPTION 'payment_quote_already_claimed' USING ERRCODE = 'P0001';
    END IF;
    SELECT account.credit_balance INTO remaining_credits
    FROM wallet_accounts account
    WHERE account.wallet_address = p_wallet_address;
    RETURN QUERY SELECT 0, remaining_credits, true;
    RETURN;
  END IF;

  IF selected_quote.status <> 'pending' OR selected_quote.expires_at + interval '30 minutes' <= now() THEN
    RAISE EXCEPTION 'payment_quote_expired' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM crypto_payment_quotes
    WHERE transaction_hash = p_transaction_hash AND id <> selected_quote.id
  ) THEN
    RAISE EXCEPTION 'payment_already_claimed' USING ERRCODE = 'P0001';
  END IF;

  UPDATE crypto_payment_quotes
  SET status = 'claimed',
      transaction_hash = p_transaction_hash,
      transaction_block = p_transaction_block,
      payer_address = p_payer_address,
      claimed_at = now()
  WHERE id = selected_quote.id;

  INSERT INTO credit_ledger (wallet_address, delta, event_type, event_reference, metadata)
  VALUES (
    p_wallet_address,
    selected_quote.credits,
    'crypto_payment',
    selected_quote.chain_id::text || ':' || p_transaction_hash,
    jsonb_build_object(
      'quoteId', selected_quote.id,
      'paymentAsset', selected_quote.payment_asset,
      'quotedUsdMicros', selected_quote.quoted_usd_micros,
      'referralCode', selected_quote.referral_code,
      'amountUnits', selected_quote.amount_units,
      'tokenAddress', selected_quote.token_address,
      'recipientAddress', selected_quote.recipient_address,
      'payerAddress', p_payer_address,
      'transactionBlock', p_transaction_block
    )
  );

  UPDATE wallet_accounts
  SET credit_balance = wallet_accounts.credit_balance + selected_quote.credits
  WHERE wallet_address = p_wallet_address
  RETURNING wallet_accounts.credit_balance INTO remaining_credits;

  RETURN QUERY SELECT selected_quote.credits, remaining_credits, false;
END;
$$;
