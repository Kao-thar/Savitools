# SaviTools

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

**Fluxa's Developer Console & Workstation for building on Stellar.**

SaviTools is the official developer console in the [Savitura](https://savitura.com) ecosystem, purpose-built for [Fluxa](https://github.com/Savitura/Fluxa) payment infrastructure. It provides interactive API playgrounds, webhook testing, SDK generation, and SEP debugging against hosted sandboxes — without needing a terminal, Rust toolchain, or deep protocol knowledge.

> **Live Deployment (Testnet Only)**: [https://savitools.savitura.com](https://savitools.savitura.com)  
> **Live API**: [https://savitools-api.savitura.com](https://savitools-api.savitura.com)  
> **Status**: Public testnet preview. Mainnet signing is strictly locked out across all tools (Composer, Wallet Sandbox, and API).

---

## Strategic Focus: Fluxa Developer Console

To avoid surface-area duplication with the official, free [Stellar Lab](https://developers.stellar.org/docs/tools/lab), SaviTools focuses strictly on serving as **Fluxa's Developer Console**. Core focus is placed on SEP-10/24 debugging, webhook testing, API playground, and SDK generation against the hosted Fluxa sandbox. Generic protocol tools that overlap with Stellar Lab are frozen. Feature requests expanding Lab overlap (e.g. #75) are closed / labelled `wontfix/stellar-lab-overlap`.

## Tools

### Fluxa Developer Console & Core Workstations

| Tool                        | What it does                                                                               | Status        |
| --------------------------- | ------------------------------------------------------------------------------------------ | ------------- |
| **API Playground**          | Interactive request builder for Fluxa (mock/sandbox) and CrowdPay (Railway) APIs           | Active (Core) |
| **Webhook Tester**          | Fire sample CrowdPay / Fluxa webhook payloads at your endpoint; inspect the response       | Active (Core) |
| **SDK Generator**           | Generate copy-paste client code (JS, Python, Go, cURL) from Fluxa/CrowdPay endpoints       | Active (Core) |
| **Federation & TOML**       | Resolve federation addresses, inspect stellar.toml files, check SEP compliance (SEP-10/24) | Active (Core) |
| **Wallet Sandbox**          | Generate testnet keypairs, fund via Friendbot, send test payments (testnet-locked)         | Active        |
| **Payment Simulator**       | Find path payment routes between assets; preview hops, rates, and fees                     | Active        |
| **Ledger Monitor**          | Watch a Stellar address or contract for live activity; set threshold alerts                | Active        |
| **Network Status**          | Live Stellar network health: ledger close time, fee tracker, Horizon latency               | Active        |
| **Liquidity Pool Explorer** | Search Stellar AMM pools, calculate LP share values, and track favorite pools              | Active        |
| **Asset Control**           | Inspect issuer authorization flags, audit trustlines, assemble clawback/flag txs           | Active        |
| **Slippage Lab**            | Price slippage tolerances against adverse rate moves in path payments                      | Active        |
| **Multisig Simulator**      | Check threshold clearance and identify outstanding signers                                 | Active        |
| **Soroban RPC**             | Schema-aware read-only Soroban JSON-RPC method invocation and response viewer              | Active        |
| **QR Handoff**              | Move unsigned/signed transactions across air gaps via animated checksummed QR frames       | Active        |
| **Soroban Storage**         | Inspect contract storage entries across Instance, Persistent, and Temporary storage        | Active        |
| **Sequence Planner**        | Plan fee bumps and sequence numbers for queued Stellar transactions                        | Active        |

### Frozen Tools (Stellar Lab Overlap)

The following tools duplicate capabilities provided natively by official [Stellar Lab](https://developers.stellar.org/docs/tools/lab). They remain functional in testnet MVP but are frozen to prioritize Fluxa and CrowdPay:

| Tool                      | What it does                                                      | Status                     | Alternative                                                           |
| ------------------------- | ----------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------- |
| **Transaction Inspector** | Decode any tx hash, Stellar address, or raw XDR                   | Frozen (MVP)               | [Stellar Lab View XDR](https://developers.stellar.org/docs/tools/lab) |
| **Transaction Composer**  | Visual builder for multi-operation Stellar transactions           | Frozen (MVP, Testnet-only) | [Stellar Lab Build Tx](https://developers.stellar.org/docs/tools/lab) |
| **Contract Deployer**     | Upload and deploy Soroban WASM files to testnet                   | Frozen (MVP)               | Stellar CLI / Lab                                                     |
| **Order Book**            | Live DEX order book and spread analytics                          | Frozen (MVP)               | Stellar.expert / Lab                                                  |
| **Account Graph**         | Visualize signer networks, offers, and payment relationships      | Frozen (MVP)               | Stellar.expert                                                        |
| **Contract Events**       | Decode, filter, and replay Soroban contract events from ScVal XDR | Frozen (MVP)               | Stellar RPC / Lab                                                     |

See the [Contract Events guide](docs/contract-events.md) for filter criteria, limits, and API usage.

---

## Architecture

```
Browser ──────────────────────────────────────────────────────────────────
  Next.js 15 (App Router) │ TypeScript │ Tailwind CSS │ shadcn/ui
──────────────────────────────────────────────────────────────────────────
                           │ HTTP
                           ▼
API ──────────────────────────────────────────────────────────────────────
  NestJS (Fastify adapter) │ TypeORM │ BullMQ │ Swagger at /api/docs
  ┌─────────────────────────────────────────────────────────────────┐
  │ modules: transaction · wallet · simulator · webhook · monitor   │
  │          playground · contracts · sdkgen · network · federation │
  │          metrics · sandbox · workspace · stellar · auth         │
  └─────────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
    PostgreSQL              Redis             Stellar Horizon
    (workspaces,        (BullMQ queues,       (testnet +
    watches, history)    rate cache)           mainnet)
```

**Monorepo layout (Turborepo)**

```
savitools/
├── apps/
│   ├── web/                      # Next.js 15 frontend
│   │   └── src/app/
│   │       ├── page.tsx          # Home / onboarding
│   │       ├── inspector/        # Transaction Inspector & Account Graph
│   │       ├── sandbox/          # Wallet Sandbox & Asset Control
│   │       ├── composer/         # Transaction Composer
│   │       ├── simulator/        # Payment Simulator, Order Book & Slippage Lab
│   │       ├── webhooks/         # Webhook Tester
│   │       ├── monitor/          # Ledger Monitor
│   │       ├── playground/       # API Playground
│   │       ├── contracts/        # Soroban Deploy Helper & Contract Events
│   │       ├── sdk/              # SDK Generator
│   │       ├── network/          # Network Status
│   │       ├── multisig/         # Multisig Simulator
│   │       ├── rpc/              # Soroban RPC Runner
│   │       ├── qr-handoff/       # Air-gapped QR transaction handoff
│   │       ├── liquidity-pools/  # Liquidity Pool Explorer
│   │       └── [locale]/         # Localized routes (i18n)
│   │           ├── soroban-storage/  # Soroban Storage Explorer
│   │           ├── sep10/            # SEP-10 WebAuth Helper
│   │           ├── sequence-planner/ # Sequence Bump Planner
│   │           └── stellar-toml/     # Stellar TOML Inspector
│   │
│   └── api/                      # NestJS backend
│       └── src/modules/
│           ├── transaction/       # Horizon lookups, XDR decode
│           ├── wallet/            # Keypair gen, Friendbot, balances
│           ├── simulator/         # Path payment route simulation
│           ├── webhook/           # Test endpoint registration + firing
│           ├── monitor/           # Horizon SSE streaming, alert rules
│           ├── playground/        # Spec proxy, API forwarding
│           ├── contracts/         # Soroban WASM upload + deploy
│           ├── sdkgen/            # Client code generation
│           ├── network/           # Fee stats, ledger health
│           ├── federation/        # TOML and address resolution
│           ├── metrics/           # Prometheus metrics export
│           ├── sandbox/           # Wallet sandbox and Friendbot
│           ├── workspace/         # Multi-tenant workspace mgmt
│           ├── stellar/           # Stellar network / RPC helpers
│           ├── stellar-toml/      # stellar.toml inspection
│           ├── sep10/             # SEP-10 WebAuth debugging
│           ├── sep24/             # SEP-24 interactive flow + redacted timeline
│           └── auth/              # User accounts, JWT, Fluxa SSO
│
├── docker-compose.yml
├── turbo.json
└── .env.example
```

---

## SEP-10 & SEP-24 Debuggers (`apps/api/src/modules`)

The SEP-10 and SEP-24 debuggers are part of the NestJS API so they are built
and tested with the rest of the backend:

- **`sep10/`** - fetches an anchor's challenge, validates its structure against
  the SEP-10 rules, signs it, and exchanges it for a JWT.
- **`sep24/`** - discovers `TRANSFER_SERVER_SEP0024`/`WEB_AUTH_ENDPOINT` from
  `stellar.toml`, starts an interactive deposit/withdrawal, polls status, and
  records a redacted diagnostic timeline (`sep24-timeline.ts`) where JWT and
  secret-key material is stripped before it is stored or exported.

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker (for local Postgres + Redis)

### 1. Install dependencies

```bash
git clone https://github.com/Savitura/Savitools
cd Savitools
npm install
```

### 2. Configure environment

Two templates, two scopes - create both:

```bash
cp .env.example .env                    # root: infrastructure + compose ports
cp apps/api/.env.example apps/api/.env  # API runtime variables
```

The compose files interpolate the **root** `.env` (Compose loads it
automatically); the per-app files are read by each app at runtime. The full-stack
compose file treats the per-app files as _optional_ overrides, so the stack still
boots when they are missing.

| Variable                       | Description                                                                                                                                                                        | Default / Example                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `DATABASE_URL`                 | PostgreSQL connection string                                                                                                                                                       | `postgresql://postgres:password@localhost:5432/savitools` |
| `REDIS_URL`                    | Redis connection string                                                                                                                                                            | `redis://localhost:6379`                                  |
| `STELLAR_NETWORK`              | Stellar network (`testnet` or `futurenet`; the API refuses to start on `mainnet`/`public`)                                                                                         | `testnet`                                                 |
| `STELLAR_HORIZON_URL`          | Horizon API URL                                                                                                                                                                    | `https://horizon-testnet.stellar.org`                     |
| `STELLAR_RPC_URL`              | Soroban RPC URL                                                                                                                                                                    | `https://soroban-rpc-testnet.stellar.org`                 |
| `STELLAR_NETWORK_PASSPHRASE`   | Passphrase matching the network (optional — falls back to the well-known passphrase)                                                                                               | `"Test SDF Network ; September 2015"`                     |
| `JWT_SECRET`                   | JWT signing secret (required; ≥32 chars in production)                                                                                                                             | Generate with `openssl rand -hex 32`                      |
| `ENCRYPTION_SECRET`            | Master secret for per-user key derivation (required in production)                                                                                                                 | Generate with `openssl rand -base64 48`                   |
| `DEPLOYER_SECRET_KEY`          | Stellar secret key required to boot — `ContractsService` reads it with `getOrThrow` and parses it with `Keypair.fromSecret` during construction; a throwaway testnet key is enough | (Required)                                                |
| `RESEND_FROM_EMAIL`            | `From` address for all transactional email                                                                                                                                         | `SaviTools <noreply@savitools.dev>`                       |
| `WEB_ORIGIN`                   | Allowed origin for API and WebSocket CORS                                                                                                                                          | `http://localhost:3000`                                   |
| `THROTTLE_TTL`                 | Rate limiting sliding window size in milliseconds                                                                                                                                  | `60000` (1 minute)                                        |
| `THROTTLE_LIMIT`               | Max requests allowed in the rate limit window                                                                                                                                      | `100`                                                     |
| `CONTRACT_ADMIN_EMAILS`        | Comma-separated emails allowed to deploy/invoke contracts (empty denies everyone)                                                                                                  | (empty)                                                   |
| `CONTRACT_DAILY_DEPLOY_QUOTA`  | Contract deploys each user may make per UTC day                                                                                                                                    | `10`                                                      |
| `CONTRACT_DAILY_INVOKE_QUOTA`  | Contract invocations each user may make per UTC day                                                                                                                                | `100`                                                     |
| `MONITOR_MAX_WATCHES_PER_USER` | Maximum Ledger Monitor watches one user may keep; enforced by `createWatch`                                                                                                        | `25`                                                      |
| `NEXT_PUBLIC_API_URL`          | Frontend → API URL                                                                                                                                                                 | `http://localhost:3001/api`                               |

**`DEPLOYER_SECRET_KEY` is required to boot the API.** `ContractsService`
reads it with `getOrThrow` and parses it with `Keypair.fromSecret` while the
module is being constructed, so the API cannot start without a syntactically
valid Stellar secret key (56 characters, starting with `S`). A throwaway,
unfunded **testnet** key is enough to start the stack - funding it is only
necessary if you actually deploy a contract. Generate one after `npm install`:

```bash
node -p "require('@stellar/stellar-sdk').Keypair.random().secret()"
```

**The deployer account is shared.** Every contract deploy, wizard deploy and
invoke made through the API is signed by, and paid for from, this one
`DEPLOYER_SECRET_KEY` account — no matter which user made the request. Access is
limited to the `CONTRACT_ADMIN_EMAILS` allowlist, and each allowlisted user has a
daily quota (`CONTRACT_DAILY_DEPLOY_QUOTA`, `CONTRACT_DAILY_INVOKE_QUOTA`, counted
per UTC day in Redis) so one user cannot drain the account. Because the key is
shared, the contracts module is **testnet/futurenet only**: the API refuses to
start when `STELLAR_NETWORK` is `mainnet`/`public` or
`STELLAR_NETWORK_PASSPHRASE` is the public network passphrase. Never put a key
that holds real XLM here.

The full list of runtime-read variables lives in `apps/api/.env.example`. On
startup, `apps/api/src/config/env-validation.ts` validates the configuration
and fails fast with an aggregated error listing every problem: missing
required URLs, non-HTTPS public URLs in production, placeholder auth or
encryption secrets, and feature variables (e.g. `RESEND_API_KEY` without
`RESEND_FROM_EMAIL`) that an enabled feature needs.

### Security & Rate Limiting

SaviTools protects its REST APIs and WebSocket connections by restricting allowed origins and rate limiting requests:

- **CORS Protection**: The WebSocket gateway and HTTP endpoints restrict incoming connections using `WEB_ORIGIN` (defaulting to `http://localhost:3000`). Make sure this is set to your frontend origin in staging/production deployments.
- **Rate Limiting**: SaviTools implements global rate limiting using `@nestjs/throttler`. By default, it allows a maximum of `100` requests within a `60000` ms (1 minute) sliding window per IP address. When exceeded, the API returns a `429 Too Many Requests` response.
  - Rate limits can be configured in your environment using `THROTTLE_LIMIT` (number of requests) and `THROTTLE_TTL` (time-to-live window in milliseconds).

### Webhook Signature Verification

Every outbound delivery — the Webhook Tester, contract-event replay, and monitor alerts —
uses one signing contract, so a single receiver implementation verifies all of them. Each
delivery is signed whenever a signing secret is in play: the per-request secret if you send
one, otherwise `WEBHOOK_SIGNING_SECRET`. Check what your deployment emits:

```bash
curl http://localhost:3001/api/webhooks/signing
# => {"enabled":true,"algorithm":"hmac-sha256","signatureHeader":"X-SaviTools-Signature",
#     "timestampHeader":"X-SaviTools-Timestamp","replayWindowSeconds":300,
#     "signedPayloadFormat":"<timestamp>.<body>","signatureFormat":"sha256=<hex>",
#     "signedPayloadEncoding":"utf-8","maxSkewSeconds":60,
#     "perRequestSecretSupported":true}
```

Every signed request carries two headers, and nothing else:

- `X-SaviTools-Timestamp`: the Unix time in seconds when the request was built
- `X-SaviTools-Signature`: `sha256=<hex>`, where the hex is HMAC-SHA256 of the UTF-8 bytes
  of `<timestamp>.<body>` — the exact request body as sent

```bash
# Reference verification, straight from the wire.
printf '%s.%s' "$X_SAVITOOLS_TIMESTAMP" "$BODY_BYTES" \
  | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET"
# compare to the X-SaviTools-Signature value, in constant time
```

To verify a signature, recompute the HMAC with your secret over the timestamp and body you
received, compare it in constant time, and reject requests whose timestamp is older than
`replayWindowSeconds` (300 s) or more than `maxSkewSeconds` (60 s) in the future. The API
exposes this exact logic as a testable utility: `apps/api/src/modules/webhook/signature.ts`
(`signBody` / `verifySignature`). A request whose timestamp is older than the replay window
should be rejected as a potential replay.

> If signing is not enabled (`enabled: false`), webhook payloads are sent unsigned — set
> `WEBHOOK_SIGNING_SECRET` before pointing receivers at your deployment. Monitor alerts always
> sign with the per-webhook secret stored for that monitor, never the env var.

#### Migrating from the legacy body-only signature

Earlier builds signed the Webhook Tester's body alone and labelled the result
`X-Webhook-Signature`, alongside an ISO-8601 `X-Timestamp`. That format has no timestamp
inside the MAC, so a captured request could be replayed verbatim, and it does not verify
against the contract above. If you still receive either legacy header:

- **Receivers** must implement the timestamped pair. To keep accepting old deliveries during a
  rollout, try the timestamped verification first and fall back to the body-only HMAC only
  when `X-SaviTools-Timestamp` is absent — then stop, since a request carrying a timestamp
  but failing the timestamped check is a forgery, not a legacy delivery.
- **Senders** do not need to do anything: all three paths emit the new pair, and the old
  headers are no longer produced. Replaying a delivery recorded under the old format strips
  the stale headers and re-signs it under the current contract, and the Webhook Tester marks
  those history entries `legacy` so it is clear the replay no longer matches the original.

### 3. Start infrastructure

```bash
docker compose up -d     # Postgres + Redis (docker-compose.yml)
```

Postgres and Redis are published on **loopback only** (`127.0.0.1`); change
`POSTGRES_PORT` / `REDIS_PORT` in the root `.env` if either port is taken.

#### Compose files & Hosting options

- `docker-compose.yml` - Postgres + Redis only for local host development. Start with `docker compose up -d` or `make infra`.
- `docker-compose.dev.yml` - Full local dev stack in Docker (`make dev`).
- `docker-compose.prod.yml` - Production stack locked to testnet (`docker compose -f docker-compose.prod.yml up -d`).
- `render.yaml` - Declarative blueprint for one-click deployment on Render (or compatible cloud platforms) running `apps/web/Dockerfile` and `apps/api/Dockerfile` with managed PostgreSQL and Redis.

```bash
make dev                                            # full stack in Docker
docker compose -f docker-compose.dev.yml config -q   # validate without starting
docker compose -f docker-compose.prod.yml config -q  # validate production config
```

It caches `node_modules` in named volumes, parameterises every published port,
and starts `web` only once `api` reports healthy, so the first request no
longer races the API's boot.

### 4. Run development servers

```bash
npm run dev
```

| Service      | URL                            |
| ------------ | ------------------------------ |
| Frontend     | http://localhost:3000          |
| API          | http://localhost:3001/api      |
| Swagger docs | http://localhost:3001/api/docs |

### 5. Run individual apps

```bash
cd apps/web && npm run dev    # frontend only
cd apps/api && npm run dev    # API only
```

---

## Development Commands

```bash
npm run dev        # start all apps in watch mode (Turborepo)
npm run build      # production build
npm run lint       # ESLint across all apps
npm run format     # Prettier
npm test           # run all tests
make seed          # seed network_samples, sandbox wallets, and webhook config (requires make dev)
```

---

## How it connects to Savitura

SaviTools is a standalone product with its own users and branding, but it's purpose-built to serve the Savitura ecosystem:

- The **API Playground** is pre-wired to Fluxa and CrowdPay APIs
- The **Webhook Tester** ships sample payloads for every CrowdPay and Fluxa event
- The **Contract Deploy Helper** makes it easy to deploy the CrowdPay Soroban escrow contract
- Connect your Fluxa account in settings to use your real API keys inside SaviTools tools

**Other Savitura projects:**

- [Fluxa](https://github.com/Savitura/Fluxa) — payment infrastructure API
- [CrowdPay](https://github.com/Savitura/crowdpay) — crowdfunding platform

---

## Documentation

Complete guides and API reference for integrating with SaviTools:

| Resource                                                                   | Purpose                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **[Architecture Map](docs/architecture-map.md)**                           | System topology: web tools, 26 API modules, and shared integration contracts |
| **[API Reference](docs/api-reference.md)**                                 | Complete endpoint catalog with examples, parameters, and error codes         |
| **[Quickstart Guide](docs/quickstart.md)**                                 | End-to-end walkthrough: generate keypair → fund → send payment in 5 minutes  |
| **[Ledger Monitor Load Test](docs/ledger-monitor-load-test.md)**           | Recorded result from the one-hour, 50-connection SSE load test               |
| **[Playground Host Smoke Check](docs/playground-host-smoke.md)**           | Read-only release check for the public production/testnet API bases          |
| **[OpenAPI Contract Gate](docs/openapi-contract.md)**                      | CI check that keeps the generated OpenAPI document aligned with API routes   |
| **[Browser & Wallet Compatibility](docs/browser-wallet-compatibility.md)** | Supported browsers, Freighter assumptions, and degraded behavior             |
| **[Browser Storage & Retention](docs/browser-storage-and-retention.md)**   | Key taxonomy, quota limits, eviction policies, and degradation behavior      |
| **[Swagger UI](/api/docs)**                                                | Interactive API explorer (available in dev/staging; disabled in production)  |

### Quick Links

- **Getting an API Key**: See [Quickstart → Step 1-2](docs/quickstart.md)
- **Finding Payment Routes**: See [API Reference → Simulator](docs/api-reference.md#simulator-payment-paths--fees)
- **Building Multi-Op Transactions**: See [API Reference → Composer](docs/api-reference.md#composer-transaction-building)
- **Authentication & Security**: See [API Reference → Authentication](docs/api-reference.md#authentication)
- **Bug Reports**: [https://github.com/Savitura/Savitools/issues](https://github.com/Savitura/Savitools/issues)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

## Observability

The API includes a Prometheus-compatible `GET /metrics` endpoint with HTTP, Soroban RPC, contract invocation, Horizon, Redis, and Node.js runtime metrics. See [API metrics](docs/metrics.md) for access control, Prometheus scrape configuration, and the Grafana dashboard import template.
