import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditActorType,
  OrderStatus,
  Prisma,
  SignerRequestStatus,
  StrategyStatus,
} from '@prisma/client';
import { InMemoryBrokerAdapter } from './broker.adapter';
import { PrismaService } from '../prisma.service';

const OPEN_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.PENDING_SIGN,
  OrderStatus.SIGNED,
  OrderStatus.SUBMITTED,
  OrderStatus.ACK,
  OrderStatus.PARTIAL_FILLED,
];

@Injectable()
export class PanicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly broker: InMemoryBrokerAdapter,
  ) {}

  async stopAll(
    userId: string,
    reason: string,
  ): Promise<{
    canceled_orders: number;
    paused_strategies: number;
    canceled_signer_requests: number;
    broker_canceled: number;
  }> {
    const brokerCanceled = await this.broker.cancelAll(userId);

    const result = await this.prisma.$transaction(async (tx) => {
      const canceledOrders = await tx.order.updateMany({
        where: {
          userId,
          status: {
            in: OPEN_ORDER_STATUSES,
          },
        },
        data: {
          status: OrderStatus.CANCELED,
          rejectReason: reason,
        },
      });

      const pausedStrategies = await tx.strategy.updateMany({
        where: {
          userId,
          status: StrategyStatus.ACTIVE,
        },
        data: {
          status: StrategyStatus.PAUSED,
          pausedReason: reason,
        },
      });

      const canceledSignerRequests = await tx.signerRequest.updateMany({
        where: {
          userId,
          OR: [
            {
              status: SignerRequestStatus.PENDING,
            },
            {
              status: SignerRequestStatus.DELIVERED,
            },
            {
              status: SignerRequestStatus.SIGNED,
              executedAt: null,
            },
          ],
        },
        data: {
          status: SignerRequestStatus.FAILED,
          denyReason: reason,
          respondedAt: new Date(),
          executionError: reason,
        },
      });

      await tx.auditLog.createMany({
        data: [
          {
            userId,
            actorType: AuditActorType.SYSTEM,
            action: AuditAction.ORDER_CANCEL_ALL,
            resourceType: 'order',
            resourceId: userId,
            metadata: {
              reason,
              canceled_count: canceledOrders.count,
            } as Prisma.InputJsonObject,
          },
          {
            userId,
            actorType: AuditActorType.SYSTEM,
            action: AuditAction.SYSTEM_PAUSE_ALL,
            resourceType: 'strategy',
            resourceId: userId,
            metadata: {
              reason,
              paused_count: pausedStrategies.count,
            } as Prisma.InputJsonObject,
          },
          {
            userId,
            actorType: AuditActorType.SYSTEM,
            action: AuditAction.ORDER_CANCEL,
            resourceType: 'signer_request',
            resourceId: userId,
            metadata: {
              reason,
              canceled_count: canceledSignerRequests.count,
            } as Prisma.InputJsonObject,
          },
        ],
      });

      return {
        canceled_orders: canceledOrders.count,
        paused_strategies: pausedStrategies.count,
        canceled_signer_requests: canceledSignerRequests.count,
      };
    });

    return {
      ...result,
      broker_canceled: brokerCanceled.canceled_count,
    };
  }
}
