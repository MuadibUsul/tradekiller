# PM Quant Monorepo (Milestone 5)

Production-oriented monorepo for a personal Polymarket quant platform with:
- `apps/web` Next.js dashboard
- `apps/api` NestJS REST API + strategy/risk/execution/safety loops
- `apps/market-worker` TS worker for simulated market metrics
- `apps/signer-gateway` NestJS WS gateway (`/ws/signer`)
- `apps/signer-electron` local signer (private key kept local)
- `packages/shared` cross-service protocol/types/hashing/zod

## 1) Local Dev Bootstrap

```bash
corepack pnpm i
corepack pnpm db:up
corepack pnpm db:migrate
```

Expected:
- Postgres and Redis containers are healthy.
- Prisma migrations apply with `...migrations applied...` style output.

## 2) Run Services (separate terminals)

```bash
corepack pnpm api:dev
corepack pnpm signer-gateway:dev
corepack pnpm market-worker:dev
corepack pnpm web:dev
corepack pnpm signer-electron:dev
```

Expected:
- API on `http://localhost:4000`
- Signer gateway on `ws://localhost:4100/ws/signer`
- Web dashboard on `http://localhost:3000`
- Market worker logs `updated metrics=...` once whitelist entries exist.

## 3) End-to-End Milestone Flow

1. Open web dashboard `http://localhost:3000`.
2. Dev login with email.
3. Create enroll session, complete OAuth start page, exchange to obtain `device_refresh_token`.
4. In Electron app:
   - paste `device_refresh_token`
   - import/unlock private key
   - refresh/connect to WS
5. In web dashboard:
   - add whitelist market
   - create mean-revert strategy
   - post mock tick
   - run strategy once
6. Observe:
   - signer request created (`GET /api/signer/requests`)
   - request pushed to Electron (auto-sign or modal confirm)
   - execution worker places fake order
   - order visible in dashboard (`GET /api/orders`)

## 4) Panic Stop

```bash
curl -X POST http://localhost:4000/api/panic/stop-all \
  -H "Authorization: Bearer <web_access_token>"
```

Expected response includes:
- `canceled_orders`
- `paused_strategies`
- `broker_canceled`

After panic stop, strategies are paused and new signer requests are not produced.

## 5) Exactly-Once Execution Lock Test

```bash
corepack pnpm api:test:exactly-once
```

Expected output:
- shows two concurrent execution attempts (`first_run`, `second_run`)
- prints `orders_created 1`
- prints `PASS exactly-once execution lock test`

## 6) Docker Compose + Caddy TLS (all services)

```bash
docker compose up -d --build
```

Routes:
- `https://app.localhost` -> web
- `https://api.localhost` -> api
- `wss://ws.localhost/ws/signer` -> signer-gateway

Note:
- `Caddyfile` uses `tls internal` for local certificates.
- For first run, trust Caddy local CA in your environment if needed.

