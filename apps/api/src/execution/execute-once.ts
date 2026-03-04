import {
  AuditAction,
  AuditActorType,
  ExecutionStatus,
  OrderSide,
  OrderStatus,
  OrderType,
  Prisma,
  PrismaClient,
  RiskLevel,
  SignerRequestStatus,
} from '@prisma/client';
import {
  ORDER_STATUSES,
  orderIntentCanonicalSchema,
  type OrderIntentCanonical,
  type OrderStatus as SharedOrderStatus,
} from '@pm-quant/shared';
import type { BrokerAdapter } from './broker.adapter';

const LOCK_TTL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 20;

interface LoggerLike {
  debug?(message: string): void;
  warn?(message: string): void;
  error?(message: string, trace?: string): void;
}

function toDecimalInput(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

function mapSharedStatusToPrisma(status: SharedOrderStatus): OrderStatus {
  if (status === ORDER_STATUSES.FILLED) {
    return OrderStatus.FILLED;
  }

  if (status === ORDER_STATUSES.ACK) {
    return OrderStatus.ACK;
  }

  if (status === ORDER_STATUSES.CANCELED) {
    return OrderStatus.CANCELED;
  }

  return OrderStatus.SUBMITTED;
}

async function finalizeExecution(
  prisma: Prisma.TransactionClient,
  input: {
    signerRequestId: string;
    executionStatus: ExecutionStatus;
    executionError?: string | null;
    executedAt: Date;
    orderData: {
      orderId: string | null;
      orderStatus: OrderStatus;
      externalOrderId: string;
      payload: OrderIntentCanonical;
    };
  },
): Promise<boolean> {
  const finalized = await prisma.signerRequest.updateMany({
    where: {
      id: input.signerRequestId,
      status: SignerRequestStatus.SIGNED,
      executedAt: null,
      executionStatus: ExecutionStatus.LOCKED,
    },
    data: {
      executedAt: input.executedAt,
      executionStatus: input.executionStatus,
      executionError: input.executionError ?? null,
    },
  });

  if (finalized.count !== 1) {
    return false;
  }

  if (input.orderData.orderId) {
    await prisma.order.update({
      where: {
        id: input.orderData.orderId,
      },
      data: {
        status: input.orderData.orderStatus,
        externalOrderId: input.orderData.externalOrderId,
      },
    });
  } else {
    const createdOrder = await prisma.order.create({
      data: {
        userId: input.orderData.payload.user_id,
        strategyId: input.orderData.payload.strategy_id,
        marketId: input.orderData.payload.market_id,
        outcomeId: input.orderData.payload.outcome_id,
        side: input.orderData.payload.side as OrderSide,
        orderType: input.orderData.payload.order_type as OrderType,
        status: input.orderData.orderStatus,
        quantity: toDecimalInput(Number(input.orderData.payload.quantity)),
        price: input.orderData.payload.price
          ? toDecimalInput(Number(input.orderData.payload.price))
          : null,
        notional: toDecimalInput(Number(input.orderData.payload.notional)),
        riskLevel: input.orderData.payload.risk_level as RiskLevel,
        externalOrderId: input.orderData.externalOrderId,
      },
    });

    await prisma.signerRequest.update({
      where: {
        id: input.signerRequestId,
      },
      data: {
        orderId: createdOrder.id,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId: input.orderData.payload.user_id,
      actorType: AuditActorType.SYSTEM,
      action: AuditAction.ORDER_SUBMIT,
      resourceType: 'signer_request',
      resourceId: input.orderData.payload.request_id,
      metadata: {
        external_order_id: input.orderData.externalOrderId,
        execution_status: input.executionStatus,
      } as Prisma.InputJsonObject,
    },
  });

  return true;
}

export async function executeSignedRequestsOnce(
  prisma: PrismaClient,
  broker: BrokerAdapter,
  logger?: LoggerLike,
  limit = DEFAULT_BATCH_SIZE,
): Promise<{ attempted: number; executed: number; skipped: number; failed: number }> {
  const now = new Date();
  const lockCutoff = new Date(now.getTime() - LOCK_TTL_MS);
  const candidates = await prisma.signerRequest.findMany({
    where: {
      status: SignerRequestStatus.SIGNED,
      executedAt: null,
      OR: [{ executionLockAt: null }, { executionLockAt: { lt: lockCutoff } }],
    },
    orderBy: {
      signedAt: 'asc',
    },
    take: limit,
  });

  let executed = 0;
  let skipped = 0;
  let failed = 0;

  for (const request of candidates) {
    const lockResult = await prisma.signerRequest.updateMany({
      where: {
        id: request.id,
        status: SignerRequestStatus.SIGNED,
        executedAt: null,
        OR: [{ executionLockAt: null }, { executionLockAt: { lt: lockCutoff } }],
      },
      data: {
        executionLockAt: new Date(),
        executionStatus: ExecutionStatus.LOCKED,
      },
    });

    if (lockResult.count !== 1) {
      skipped += 1;
      continue;
    }

    const lockedRequest = await prisma.signerRequest.findUnique({
      where: {
        id: request.id,
      },
    });

    if (!lockedRequest) {
      skipped += 1;
      continue;
    }

    const parsedPayload = orderIntentCanonicalSchema.safeParse(lockedRequest.payload);

    if (!parsedPayload.success) {
      failed += 1;
      await prisma.signerRequest.update({
        where: {
          id: lockedRequest.id,
        },
        data: {
          executedAt: new Date(),
          executionStatus: ExecutionStatus.FAILED,
          executionError: 'invalid_payload_shape',
        },
      });
      logger?.warn?.(`Execution failed request_id=${lockedRequest.requestId} reason=invalid_payload`);
      continue;
    }

    if (!lockedRequest.signature) {
      failed += 1;
      await prisma.signerRequest.update({
        where: {
          id: lockedRequest.id,
        },
        data: {
          executedAt: new Date(),
          executionStatus: ExecutionStatus.FAILED,
          executionError: 'missing_signature',
        },
      });
      logger?.warn?.(`Execution failed request_id=${lockedRequest.requestId} reason=missing_signature`);
      continue;
    }

    try {
      const brokerResult = await broker.placeOrder(parsedPayload.data, lockedRequest.signature);
      const orderStatus = mapSharedStatusToPrisma(brokerResult.status);
      const executionStatus =
        brokerResult.status === ORDER_STATUSES.FILLED ? ExecutionStatus.FILLED : ExecutionStatus.ACK;

      const done = await prisma.$transaction((tx) =>
        finalizeExecution(tx, {
          signerRequestId: lockedRequest.id,
          executionStatus,
          executedAt: new Date(),
          orderData: {
            orderId: lockedRequest.orderId,
            orderStatus,
            externalOrderId: brokerResult.external_order_id,
            payload: parsedPayload.data,
          },
        }),
      );

      if (done) {
        executed += 1;
        logger?.debug?.(
          `Executed request_id=${lockedRequest.requestId} external_order_id=${brokerResult.external_order_id}`,
        );
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      const executionError = error instanceof Error ? error.message : 'unknown_execution_error';

      await prisma.signerRequest.updateMany({
        where: {
          id: lockedRequest.id,
          status: SignerRequestStatus.SIGNED,
          executedAt: null,
        },
        data: {
          executedAt: new Date(),
          executionStatus: ExecutionStatus.FAILED,
          executionError,
        },
      });

      logger?.error?.(`Execution failed request_id=${lockedRequest.requestId}`, executionError);
    }
  }

  return {
    attempted: candidates.length,
    executed,
    skipped,
    failed,
  };
}
