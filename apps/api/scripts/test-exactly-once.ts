import { ExecutionStatus, Prisma, PrismaClient, SignerRequestStatus } from '@prisma/client';
import {
  ORDER_SIDES,
  ORDER_TYPES,
  PROTO_VER,
  RISK_LEVELS,
  hashOrderIntentCanonical,
  type OrderIntentCanonical,
} from '@pm-quant/shared';
import { randomUUID } from 'node:crypto';
import { InMemoryBrokerAdapter } from '../src/execution/broker.adapter';
import { executeSignedRequestsOnce } from '../src/execution/execute-once';

async function main() {
  const prisma = new PrismaClient();
  const broker = new InMemoryBrokerAdapter();

  try {
    await prisma.$connect();

    const email = `exactly-once-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
      },
    });

    const requestId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 120_000);
    const payload: OrderIntentCanonical = {
      proto_ver: PROTO_VER,
      request_id: requestId,
      user_id: user.id,
      device_id: 'unassigned',
      strategy_id: null,
      market_id: 'm-exactly-once',
      outcome_id: 'YES',
      side: ORDER_SIDES.BUY,
      order_type: ORDER_TYPES.LIMIT,
      quantity: '10.00000000',
      price: '0.500000',
      notional: '5.000000',
      risk_level: RISK_LEVELS.MEDIUM,
      nonce: `nonce-${requestId}`,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    const created = await prisma.signerRequest.create({
      data: {
        requestId,
        userId: user.id,
        status: SignerRequestStatus.SIGNED,
        payload: payload as unknown as Prisma.InputJsonObject,
        payloadHash: hashOrderIntentCanonical(payload),
        requiresConfirm: false,
        confirmReasons: [],
        anomalyFlags: [],
        expiresAt,
        signature: '0xexactlyoncesignature',
        deviceSig: '',
        signedAt: now,
        respondedAt: now,
        executionStatus: ExecutionStatus.PENDING,
      },
    });

    const [firstRun, secondRun] = await Promise.all([
      executeSignedRequestsOnce(prisma, broker),
      executeSignedRequestsOnce(prisma, broker),
    ]);

    const orders = await prisma.order.findMany({
      where: {
        userId: user.id,
      },
    });

    const updatedRequest = await prisma.signerRequest.findUnique({
      where: {
        id: created.id,
      },
    });

    console.log('first_run', firstRun);
    console.log('second_run', secondRun);
    console.log('orders_created', orders.length);
    console.log('request_execution_status', updatedRequest?.executionStatus ?? 'missing');
    console.log('request_executed_at', updatedRequest?.executedAt?.toISOString() ?? 'null');

    if (orders.length !== 1) {
      throw new Error(`Expected exactly one order, got ${orders.length}`);
    }

    if (!updatedRequest?.executedAt) {
      throw new Error('Expected executedAt to be set');
    }

    console.log('PASS exactly-once execution lock test');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('FAIL exactly-once execution lock test', error);
  process.exit(1);
});

