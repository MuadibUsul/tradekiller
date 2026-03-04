FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_BASE_URL=https://api.localhost
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --frozen-lockfile

COPY apps/web apps/web

RUN pnpm --filter @pm-quant/web build

FROM node:22-alpine
WORKDIR /repo
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_BASE_URL=https://api.localhost

COPY --from=build /repo /repo

EXPOSE 3000
CMD ["pnpm", "--filter", "@pm-quant/web", "start"]
