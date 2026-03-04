# Signer Electron (M4)

## Local run

1. Install dependencies at repo root:
   - `corepack pnpm install`
2. If Electron binary was blocked by pnpm build-script policy, allow and rebuild:
   - `corepack pnpm approve-builds`
   - select `electron` (and `esbuild` if prompted)
   - then run `corepack pnpm --filter @pm-quant/signer-electron rebuild electron`
3. Start required services:
   - `corepack pnpm db:up`
   - `corepack pnpm db:migrate`
   - `corepack pnpm api:dev`
   - `corepack pnpm signer-gateway:dev`
4. Start signer app:
   - `corepack pnpm signer-electron:dev`

## First-time flow

1. Paste `device_refresh_token` from `/api/signer/oauth/exchange` into the app and click **Save Refresh Token**.
2. Click **Refresh Access + Connect**.
3. Import private key with password using **Import + Encrypt**.
4. Create test signer request from API (`POST /api/signer/test-request`).
5. Observe auto-sign or confirm modal depending on `requires_confirm` and anomaly policy.
