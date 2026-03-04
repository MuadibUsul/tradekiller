FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/market-worker/package.json apps/market-worker/package.json
COPY apps/api/package.json apps/api/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/market-worker apps/market-worker
COPY apps/api apps/api

RUN pnpm --filter @pm-quant/shared build
RUN pnpm --filter @pm-quant/api prisma:generate
RUN pnpm --filter @pm-quant/market-worker build

FROM node:22-alpine
WORKDIR /repo
RUN corepack enable

COPY --from=build /repo /repo

CMD ["pnpm", "--filter", "@pm-quant/market-worker", "start"]