# Trait Forge

Browser-based NFT collection generator for mixing traits, assigning rarity,
creating compatibility rules, previewing combinations, and exporting images and
metadata as a ZIP.

Artwork sources can be layered PSDs, PNG/JPEG/WebP files, or native `.procreate`
documents. Procreate documents are read entirely in the browser and use their
embedded Quick Look PNG as flattened artwork; export a layered PSD from Procreate
when individual native layers must become Trait Forge folders and traits.

## Development

```bash
npm install
npm run dev
```

ZIP generation is credit-gated on deployed hosts. Users can buy 3 generation
credits for approximately $20 in official USDC or native ETH on Base by sending
from any wallet and pasting the transaction hash. No wallet connection or user
registration is required. Referral codes `ezzie`, `ink`, `filthy`, and
`smolemaru` reduce the payment by $5 and grant four credits instead of three.
Manually issued generation codes remain available as a separate option.
Loopback hosts (`localhost`, `127.0.0.1`, and `::1`) bypass codes so local
development and previews remain free.

## Production setup

1. Create a Neon PostgreSQL database and set `DATABASE_URL` in Vercel.
2. Open Neon's SQL Editor and run the SQL files in `db/migrations/` in numeric
   order, or
   run the idempotent migration locally with a connection string copied directly
   from Neon:

   ```bash
   DATABASE_URL='postgresql://...' npm run migrate
   ```
3. Copy every variable in `.env.example` into Vercel Production settings. Use
   separate random values for `SESSION_SECRET` and `CODE_PEPPER`.
4. `BASE_PAYMENT_ADDRESS` is configured as
   `0xC7A7Ca7D3cfD3e8442c5A57a42A46fD655738276` for Base USDC and ETH payments.
   You can override it with an environment variable. Never configure or deploy
   a private key. `BASE_RPC_URL` defaults to Base's
   registration-free public endpoint, which Base documents as rate limited and
   unsuitable for high-volume production. Running your own Base node is the
   no-registration option for higher reliability.
5. Set `ROBINHOOD_RPC_URL` to a private mainnet RPC with historical receipts if
   the legacy HOODCHAN burn flow is enabled.
6. Create a private Vercel Blob store before enabling server-side source uploads.

The payment wall accepts the official Base USDC contract
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` or native Base ETH. ETH quotes use
Chainlink's Base ETH/USD feed at `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70`.
Each anonymous browser receives a short-lived exact amount close to $20, or $15
when a valid referral code is applied. Referral links can prefill a code with
`?ref=code`. The
small amount variation binds a public blockchain transaction to that browser so
another visitor cannot copy the transaction hash and steal the credits.
Payments are credited once after the configured Base confirmation count (five
by default).

Referral performance is available in the database view `referral_code_stats`.
It reports quotes started, completed payments, conversion, paid revenue,
credits and bonus credits granted, discounts, and the latest payment for each
source. View it from a trusted terminal with:

```bash
DATABASE_URL='postgresql://...' npm run referral:stats
```

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
