import { Prisma, PrismaClient } from '@prisma/client';
import { PROTO_VER } from '@pm-quant/shared';

const prisma = new PrismaClient();
const intervalMs = Number(process.env.MARKET_WORKER_INTERVAL_MS ?? '1000');

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(8));
}

async function upsertSimulatedMetric(userId: string, marketId: string): Promise<void> {
  const existing = await prisma.marketMetric.findUnique({
    where: {
      userId_marketId: {
        userId,
        marketId,
      },
    },
  });

  const previousPrice = existing ? Number(existing.pMkt) : randomBetween(0.45, 0.55);
  const nextPrice = clamp(previousPrice + randomBetween(-0.015, 0.015), 0.01, 0.99);
  const nextSpread = clamp(randomBetween(0.002, 0.03), 0, 0.2);
  const nextTickAge = clamp(randomBetween(0.2, 3.0), 0, 10);
  const nextLiquidity = clamp(randomBetween(40, 220), 0, 10_000);
  const nextJump = clamp(randomBetween(0, 0.08), 0, 1);

  await prisma.marketMetric.upsert({
    where: {
      userId_marketId: {
        userId,
        marketId,
      },
    },
    update: {
      pMkt: toDecimal(nextPrice),
      spreadPct: toDecimal(nextSpread),
      lastTickAge: toDecimal(nextTickAge),
      topLiquidity: toDecimal(nextLiquidity),
      jumpPct1m: toDecimal(nextJump),
    },
    create: {
      userId,
      marketId,
      pMkt: toDecimal(nextPrice),
      spreadPct: toDecimal(nextSpread),
      lastTickAge: toDecimal(nextTickAge),
      topLiquidity: toDecimal(nextLiquidity),
      jumpPct1m: toDecimal(nextJump),
    },
  });
}

async function tick(): Promise<void> {
  const whitelisted = await prisma.whitelistMarket.findMany({
    where: {
      enabled: true,
    },
    select: {
      userId: true,
      marketId: true,
    },
    take: 500,
  });

  for (const market of whitelisted) {
    await upsertSimulatedMetric(market.userId, market.marketId);
  }

  if (whitelisted.length > 0) {
    console.log(`[market-worker] updated metrics=${whitelisted.length}`);
  }
}

async function bootstrap(): Promise<void> {
  console.log(`[market-worker] starting (proto=${PROTO_VER}) interval=${intervalMs}ms`);
  await prisma.$connect();

  await tick();
  setInterval(() => {
    void tick().catch((error: unknown) => {
      console.error('[market-worker] tick failed', error);
    });
  }, intervalMs);
}

bootstrap().catch((error: unknown) => {
  console.error('[market-worker] failed to start', error);
  process.exit(1);
});

process.on('SIGTERM', () => {
  void prisma.$disconnect().finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  void prisma.$disconnect().finally(() => process.exit(0));
});
