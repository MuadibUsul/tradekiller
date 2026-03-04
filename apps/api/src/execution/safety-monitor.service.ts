import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  AuditAction,
  AuditActorType,
  DeviceStatus,
  Prisma,
  StrategyStatus,
} from '@prisma/client';
import { meanRevertStrategyParamsSchema } from '@pm-quant/shared';
import { PrismaService } from '../prisma.service';
import { PanicService } from './panic.service';

const OFFLINE_THRESHOLD_MS = 10_000;
const SAFETY_INTERVAL_MS = 5_000;

@Injectable()
export class SafetyMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SafetyMonitorService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly lastOfflineTriggerByUser = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly panicService: PanicService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runOnce();
    }, SAFETY_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<{ checked_users: number; stale_pauses: number }> {
    if (this.running) {
      return {
        checked_users: 0,
        stale_pauses: 0,
      };
    }

    this.running = true;

    try {
      const activeStrategies = await this.prisma.strategy.findMany({
        where: {
          status: StrategyStatus.ACTIVE,
        },
        select: {
          id: true,
          userId: true,
          config: true,
        },
      });

      const userIds = Array.from(new Set(activeStrategies.map((strategy) => strategy.userId)));
      let stalePauses = 0;

      const cutoff = new Date(Date.now() - OFFLINE_THRESHOLD_MS);

      for (const userId of userIds) {
        const onlineDevice = await this.prisma.device.findFirst({
          where: {
            userId,
            status: DeviceStatus.ONLINE,
            lastSeenAt: {
              gt: cutoff,
            },
          },
          select: {
            id: true,
          },
        });

        if (!onlineDevice) {
          const nowTs = Date.now();
          const lastTriggeredAt = this.lastOfflineTriggerByUser.get(userId) ?? 0;

          if (nowTs - lastTriggeredAt < OFFLINE_THRESHOLD_MS) {
            continue;
          }

          this.lastOfflineTriggerByUser.set(userId, nowTs);
          await this.panicService.stopAll(userId, 'signer_offline_timeout');
          this.logger.warn(`Triggered stop-all for user=${userId} reason=signer_offline_timeout`);
          continue;
        }

        this.lastOfflineTriggerByUser.delete(userId);
      }

      for (const strategy of activeStrategies) {
        const parsed = meanRevertStrategyParamsSchema.safeParse(strategy.config);

        if (!parsed.success) {
          continue;
        }

        const riskConfig = await this.prisma.riskConfig.findFirst({
          where: {
            userId: strategy.userId,
            OR: [{ strategyId: strategy.id }, { strategyId: null }],
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        const staleTickSeconds = riskConfig?.staleTickSeconds ?? 5;
        const metric = await this.prisma.marketMetric.findUnique({
          where: {
            userId_marketId: {
              userId: strategy.userId,
              marketId: parsed.data.market_id,
            },
          },
        });

        if (!metric || Number(metric.lastTickAge) <= staleTickSeconds) {
          continue;
        }

        const updated = await this.prisma.strategy.updateMany({
          where: {
            id: strategy.id,
            status: StrategyStatus.ACTIVE,
          },
          data: {
            status: StrategyStatus.PAUSED,
            pausedReason: 'market_data_stale',
          },
        });

        if (updated.count === 0) {
          continue;
        }

        stalePauses += 1;

        await this.prisma.auditLog.create({
          data: {
            userId: strategy.userId,
            actorType: AuditActorType.SYSTEM,
            action: AuditAction.STRATEGY_PAUSE,
            resourceType: 'strategy',
            resourceId: strategy.id,
            metadata: {
              reason: 'market_data_stale',
              stale_tick_age: Number(metric.lastTickAge),
              stale_tick_limit: staleTickSeconds,
            } as Prisma.InputJsonObject,
          },
        });
      }

      return {
        checked_users: userIds.length,
        stale_pauses: stalePauses,
      };
    } finally {
      this.running = false;
    }
  }
}
