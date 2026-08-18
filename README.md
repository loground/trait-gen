# Trait Forge

Browser-based NFT collection generator for mixing traits, assigning rarity,
creating compatibility rules, previewing combinations, and exporting images and
metadata as a ZIP.

## Development

```bash
npm install
npm run dev
```

ZIP generation is code-gated on deployed hosts. A valid code grants generation
credits to an anonymous browser session; no wallet or payment is required.
Loopback hosts (`localhost`, `127.0.0.1`, and `::1`) bypass codes so local
development and previews remain free.

## Production setup

1. Create a Neon PostgreSQL database and set `DATABASE_URL` in Vercel.
2. Open Neon's SQL Editor and run `db/migrations/001_credit_ledger.sql`, or
   run the idempotent migration locally with a connection string copied directly
   from Neon:

   ```bash
   DATABASE_URL='postgresql://...' npm run migrate
   ```
3. Copy every variable in `.env.example` into Vercel Production settings. Use
   separate random values for `SESSION_SECRET` and `CODE_PEPPER`.
4. Set `ROBINHOOD_RPC_URL` to a private mainnet RPC with historical receipts.
5. Create a private Vercel Blob store before enabling server-side source uploads.

Create a private generation code from a trusted terminal:

```bash
CODE_PEPPER=... DATABASE_URL=... npm run code:create -- --credits 1 --uses 1
```

Create a batch of 25 single-use, one-generation codes:

```bash
CODE_PEPPER=... DATABASE_URL=... npm run code:create -- --count 25 --credits 1 --uses 1
```

Never expose database, session, RPC, Blob, or code secrets through a
`VITE_` environment variable. Anything prefixed with `VITE_` is shipped to the
browser.

## Generation model

Image composition runs in the browser. Large collections should be generated on
a capable desktop browser because the work can require significant memory and CPU.
