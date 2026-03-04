import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  AuditActorType,
  OrderSide,
  OrderStatus,
  OrderType,
  Prisma,
  RiskConfig,
  RiskLevel,
  SignerRequestStatus,
  Strategy,
  StrategyStatus,
} from '@prisma/client';
import {
  ANOMALY_FLAGS,
  CONFIRM_REASONS,
  ORDER_TYPES,
  PROTO_VER,
  RISK_GATE_DECISIONS,
  hashOrderIntentCanonical,
  marketMetricSnapshotSchema,
  meanRevertStrategyParamsSchema,
  type AnomalyFlag,
  type ConfirmReason,
  type MarketMetricSnapshot,
  type MeanRevertStrategyParams,
  type OrderIntentCanonical,
  type RiskGateDecision,
} from '@pm-quant/shared';
import { randomUUID } from 'node:crypto';
import { PanicService } from '../execution/panic.service';
import { PrismaService } from '../prisma.service';

interface RiskGateEvaluation {
  decision: RiskGateDecision;
  rejectReason: string | null;
  requiresConfirm: boolean;
  confirmReasons: ConfirmReason[];
  anomalyFlags: AnomalyFlag[];
  adjustedNotional: number;
  adjustedQuantity: number;
  postTradeMarketExposure: number;
  postTradeTotalExposure: number;
}

interface CreateSignerRequestInput {
  userId: string;
  strategy: Strategy;
  params: MeanRevertStrategyParams;
  marketPrice: number;
  orderSide: OrderSide;
  riskLevel: RiskLevel;
  adjustedNotional: number;
  adjustedQuantity: number;
  evaluation: RiskGateEvaluation;
}

interface StrategyRunSummary {
  processed: number;
  created: number;
  rejected: number;
  skipped: number;
  request_ids: string[];
}

function toNumber(value: Prisma.Decimal | number): number {
  if (typeof value === 'number') {
    return value;
  }

  return Number(value);
}

function toDecimalInput(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

function toFixedString(value: number, digits = 6): string {
  return value.toFixed(digits);
}

function sum(values: number[]): number {
  return values.reduce((acc, current) => acc + current, 0);
}

function unique<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function parseStrategyConfig(strategy: Strategy): MeanRevertStrategyParams | null {
  const parsed = meanRevertStrategyParamsSchema.safeParse(strategy.config);
  return parsed.success ? parsed.data : null;
}

@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly panicService: PanicService,
  ) {}

  async listWhitelist(userId: string) {
    return this.prisma.whitelistMarket.findMany({
      where: { userId },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async createWhitelist(userId: string, marketIdRaw: string, noteRaw?: string) {
    const marketId = marketIdRaw.trim();

    if (!marketId) {
      throw new BadRequestException('market_id is required');
    }

    const note = noteRaw?.trim();

    return this.prisma.whitelistMarket.upsert({
      where: {
        userId_marketId: {
          userId,
          marketId,
        },
      },
      create: {
        userId,
        marketId,
        enabled: true,
        note: note && note.length > 0 ? note : null,
      },
      update: {
        enabled: true,
        note: note && note.length > 0 ? note : null,
      },
    });
  }

  async upsertMarketMetric(
    userId: string,
    snapshot: Omit<MarketMetricSnapshot, 'user_id'>,
  ): Promise<{ market_id: string; updated_at: string }> {
    const parsed = marketMetricSnapshotSchema.safeParse({
      user_id: userId,
      ...snapshot,
    });

    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }

    const data = parsed.data;

    const metric = await this.prisma.marketMetric.upsert({
      where: {
        userId_marketId: {
          userId: data.user_id,
          marketId: data.market_id,
        },
      },
      update: {
        pMkt: toDecimalInput(data.p_mkt),
        lastTickAge: toDecimalInput(data.last_tick_age),
        spreadPct: toDecimalInput(data.spread_pct),
        topLiquidity: toDecimalInput(data.top_liquidity),
        jumpPct1m: toDecimalInput(data.jump_pct_1m),
      },
      create: {
        userId: data.user_id,
        marketId: data.market_id,
        pMkt: toDecimalInput(data.p_mkt),
        lastTickAge: toDecimalInput(data.last_tick_age),
        spreadPct: toDecimalInput(data.spread_pct),
        topLiquidity: toDecimalInput(data.top_liquidity),
        jumpPct1m: toDecimalInput(data.jump_pct_1m),
      },
    });

    return {
      market_id: metric.marketId,
      updated_at: metric.updatedAt.toISOString(),
    };
  }

  async listMarketMetrics(userId: string) {
    return this.prisma.marketMetric.findMany({
      where: { userId },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  async createMeanRevertStrategy(
    userId: string,
    input: {
      name: string;
      market_id: string;
      outcome_id: string;
      entry_edge: number;
      order_notional: number;
      p_fair_manual: number;
      activate?: boolean;
      equity?: number;
    },
  ) {
    const parsed = meanRevertStrategyParamsSchema.safeParse({
      type: 'MEAN_REVERT',
      market_id: input.market_id,
      outcome_id: input.outcome_id,
      entry_edge: input.entry_edge,
      order_notional: input.order_notional,
      fair_source: 'MANUAL',
      p_fair_manual: input.p_fair_manual,
    });

    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }

    const strategy = await this.prisma.strategy.create({
      data: {
        userId,
        name: input.name.trim(),
        status: input.activate === false ? StrategyStatus.PAUSED : StrategyStatus.ACTIVE,
        config: parsed.data as unknown as Prisma.InputJsonObject,
      },
    });

    await this.ensureRiskConfig(userId, strategy.id, input.equity);

    await this.prisma.auditLog.create({
      data: {
        userId,
        actorType: AuditActorType.USER,
        action: AuditAction.STRATEGY_CREATE,
        resourceType: 'strategy',
        resourceId: strategy.id,
        metadata: {
          config: parsed.data as unknown as Prisma.InputJsonObject,
        },
      },
    });

    return strategy;
  }

  async listStrategies(userId: string) {
    return this.prisma.strategy.findMany({
      where: { userId },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async setStrategyStatus(userId: string, strategyId: string, status: StrategyStatus) {
    const strategy = await this.prisma.strategy.findFirst({
      where: {
        id: strategyId,
        userId,
      },
    });

    if (!strategy) {
      throw new BadRequestException('strategy not found');
    }

    return this.prisma.strategy.update({
      where: {
        id: strategy.id,
      },
      data: {
        status,
        pausedReason: status === StrategyStatus.PAUSED ? strategy.pausedReason ?? 'manual_pause' : null,
      },
    });
  }

  async runStrategiesOnce(userId: string): Promise<StrategyRunSummary> {
    const strategies = await this.prisma.strategy.findMany({
      where: {
        userId,
        status: StrategyStatus.ACTIVE,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    let created = 0;
    let rejected = 0;
    let skipped = 0;
    const requestIds: string[] = [];

    for (const strategy of strategies) {
      const params = parseStrategyConfig(strategy);

      if (!params) {
        await this.pauseStrategyWithReason(strategy.id, 'invalid_strategy_config');
        skipped += 1;
        continue;
      }

      const whitelist = await this.prisma.whitelistMarket.findUnique({
        where: {
          userId_marketId: {
            userId,
            marketId: params.market_id,
          },
        },
      });

      if (!whitelist || !whitelist.enabled) {
        skipped += 1;
        continue;
      }

      const metric = await this.prisma.marketMetric.findUnique({
        where: {
          userId_marketId: {
            userId,
            marketId: params.market_id,
          },
        },
      });

      if (!metric) {
        skipped += 1;
        continue;
      }

      const marketPrice = toNumber(metric.pMkt);
      const entryEdge = Math.abs(params.p_fair_manual - marketPrice);

      if (entryEdge < params.entry_edge) {
        skipped += 1;
        continue;
      }

      const riskConfig = await this.loadRiskConfigForStrategy(userId, strategy.id);
      const staleTickLimit = riskConfig.staleTickSeconds;
      const lastTickAge = toNumber(metric.lastTickAge);

      if (lastTickAge > staleTickLimit) {
        await this.pauseStrategyWithReason(strategy.id, 'market_data_stale');
        skipped += 1;
        continue;
      }

      const side = params.p_fair_manual > marketPrice ? OrderSide.BUY : OrderSide.SELL;
      const requestedNotional = params.order_notional;
      const requestedQuantity = requestedNotional / marketPrice;

      const existingPending = await this.prisma.signerRequest.findFirst({
        where: {
          userId,
          OR: [
            {
              status: {
                in: [SignerRequestStatus.PENDING, SignerRequestStatus.DELIVERED],
              },
              expiresAt: {
                gt: new Date(),
              },
              order: {
                strategyId: strategy.id,
                marketId: params.market_id,
              },
            },
            {
              status: SignerRequestStatus.SIGNED,
              executedAt: null,
              order: {
                strategyId: strategy.id,
                marketId: params.market_id,
              },
            },
          ],
        },
        select: {
          requestId: true,
        },
      });

      if (existingPending) {
        skipped += 1;
        continue;
      }

      const evaluation = await this.evaluateRiskGate({
        userId,
        strategyId: strategy.id,
        marketId: params.market_id,
        requestedNotional,
        requestedQuantity,
        pFair: params.p_fair_manual,
        pMkt: marketPrice,
        riskConfig,
        riskLevel: riskConfig.riskLevel,
        lastTickAge,
        spreadPct: toNumber(metric.spreadPct),
        topLiquidity: toNumber(metric.topLiquidity),
        jumpPct1m: toNumber(metric.jumpPct1m),
      });

      await this.writeRiskDecisionAudit(userId, strategy.id, params.market_id, evaluation);

      if (evaluation.decision === RISK_GATE_DECISIONS.REJECT) {
        rejected += 1;

        if (evaluation.rejectReason === 'daily_loss_circuit_breaker') {
          await this.panicService.stopAll(userId, 'daily_loss_circuit_breaker');
        }

        continue;
      }

      const requestId = await this.createSignerRequest({
        userId,
        strategy,
        params,
        marketPrice,
        orderSide: side,
        riskLevel: riskConfig.riskLevel,
        adjustedNotional: evaluation.adjustedNotional,
        adjustedQuantity: evaluation.adjustedQuantity,
        evaluation,
      });

      created += 1;
      requestIds.push(requestId);
    }

    return {
      processed: strategies.length,
      created,
      rejected,
      skipped,
      request_ids: requestIds,
    };
  }

  async listSignerRequests(userId: string) {
    return this.prisma.signerRequest.findMany({
      where: { userId },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });
  }

  async listOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      orderBy: {
        createdAt: 'desc',
      },
      take: 200,
    });
  }

  private async createSignerRequest(input: CreateSignerRequestInput): Promise<string> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 1000);
    const requestId = randomUUID();
    const notionalString = toFixedString(input.adjustedNotional);
    const quantityString = toFixedString(input.adjustedQuantity, 8);
    const priceString = toFixedString(input.marketPrice);

    const payload: OrderIntentCanonical = {
      proto_ver: PROTO_VER,
      request_id: requestId,
      user_id: input.userId,
      device_id: 'unassigned',
      strategy_id: input.strategy.id,
      market_id: input.params.market_id,
      outcome_id: input.params.outcome_id,
      side: input.orderSide,
      order_type: ORDER_TYPES.LIMIT,
      quantity: quantityString,
      price: priceString,
      notional: notionalString,
      risk_level: input.riskLevel,
      nonce: `nonce-${requestId}`,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    const payloadHash = hashOrderIntentCanonical(payload);

    const createdRequestId = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          userId: input.userId,
          strategyId: input.strategy.id,
          marketId: input.params.market_id,
          outcomeId: input.params.outcome_id,
          side: input.orderSide,
          orderType: OrderType.LIMIT,
          status: OrderStatus.PENDING_SIGN,
          quantity: toDecimalInput(input.adjustedQuantity),
          price: toDecimalInput(input.marketPrice),
          notional: toDecimalInput(input.adjustedNotional),
          riskLevel: input.riskLevel,
        },
      });

      const signerRequest = await tx.signerRequest.create({
        data: {
          requestId,
          userId: input.userId,
          orderId: order.id,
          status: SignerRequestStatus.PENDING,
          payload: payload as unknown as Prisma.InputJsonObject,
          payloadHash,
          requiresConfirm: input.evaluation.requiresConfirm,
          confirmReasons: input.evaluation.confirmReasons,
          anomalyFlags: input.evaluation.anomalyFlags,
          display: {
            strategy_name: input.strategy.name,
            market_id: input.params.market_id,
            outcome_id: input.params.outcome_id,
            side: input.orderSide,
            quantity: quantityString,
            price: priceString,
            notional: notionalString,
            post_trade_market_exposure: input.evaluation.postTradeMarketExposure,
            post_trade_total_exposure: input.evaluation.postTradeTotalExposure,
          } as Prisma.InputJsonObject,
          expiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: input.userId,
          actorType: AuditActorType.SYSTEM,
          action: AuditAction.SIGNER_REQUEST_CREATE,
          resourceType: 'signer_request',
          resourceId: signerRequest.requestId,
          metadata: {
            decision: input.evaluation.decision,
            confirm_reasons: input.evaluation.confirmReasons,
            anomaly_flags: input.evaluation.anomalyFlags,
          } as Prisma.InputJsonObject,
        },
      });

      return signerRequest.requestId;
    });

    return createdRequestId;
  }

  private async evaluateRiskGate(input: {
    userId: string;
    strategyId: string;
    marketId: string;
    requestedNotional: number;
    requestedQuantity: number;
    pFair: number;
    pMkt: number;
    riskConfig: RiskConfig;
    riskLevel: RiskLevel;
    lastTickAge: number;
    spreadPct: number;
    topLiquidity: number;
    jumpPct1m: number;
  }): Promise<RiskGateEvaluation> {
    const equity = toNumber(input.riskConfig.equity);
    const [positions, openOrders] = await Promise.all([
      this.prisma.position.findMany({
        where: {
          userId: input.userId,
        },
      }),
      this.prisma.order.findMany({
        where: {
          userId: input.userId,
          status: {
            in: [
              OrderStatus.PENDING_SIGN,
              OrderStatus.SIGNED,
              OrderStatus.SUBMITTED,
              OrderStatus.ACK,
              OrderStatus.PARTIAL_FILLED,
            ],
          },
        },
      }),
    ]);

    const positionMarketExposure = sum(
      positions
        .filter((position) => position.marketId === input.marketId)
        .map((position) => Math.abs(toNumber(position.notional))),
    );
    const positionTotalExposure = sum(positions.map((position) => Math.abs(toNumber(position.notional))));
    const openOrderMarketExposure = sum(
      openOrders
        .filter((order) => order.marketId === input.marketId)
        .map((order) => Math.abs(toNumber(order.notional))),
    );
    const openOrderTotalExposure = sum(openOrders.map((order) => Math.abs(toNumber(order.notional))));
    const marketExposure = positionMarketExposure + openOrderMarketExposure;
    const totalExposure = positionTotalExposure + openOrderTotalExposure;
    const openMarketCount = new Set(
      [
        ...positions
          .filter((position) => Math.abs(toNumber(position.notional)) > 0)
          .map((position) => position.marketId),
        ...openOrders
          .filter((order) => Math.abs(toNumber(order.notional)) > 0)
          .map((order) => order.marketId),
      ],
    ).size;

    const totalPnl = sum(
      positions.map((position) => toNumber(position.realizedPnl) + toNumber(position.unrealizedPnl)),
    );
    const dailyLoss = Math.max(0, -totalPnl);
    const dailyLossLimit = equity * toNumber(input.riskConfig.dailyLossCircuitBreakerPct);

    if (dailyLoss >= dailyLossLimit) {
      return {
        decision: RISK_GATE_DECISIONS.REJECT,
        rejectReason: 'daily_loss_circuit_breaker',
        requiresConfirm: false,
        confirmReasons: [],
        anomalyFlags: [],
        adjustedNotional: 0,
        adjustedQuantity: 0,
        postTradeMarketExposure: marketExposure,
        postTradeTotalExposure: totalExposure,
      };
    }

    const maxMarketExposure = equity * toNumber(input.riskConfig.maxMarketExposurePct);
    const maxTotalExposure = equity * toNumber(input.riskConfig.maxTotalExposurePct);
    const warnMarketExposure = equity * toNumber(input.riskConfig.warnMarketExposurePct);

    const marketRemaining = maxMarketExposure - marketExposure;
    const totalRemaining = maxTotalExposure - totalExposure;
    const allowedNotional = Math.min(input.requestedNotional, marketRemaining, totalRemaining);

    if (allowedNotional <= 0) {
      return {
        decision: RISK_GATE_DECISIONS.REJECT,
        rejectReason: 'max_exposure_reached',
        requiresConfirm: false,
        confirmReasons: [],
        anomalyFlags: [],
        adjustedNotional: 0,
        adjustedQuantity: 0,
        postTradeMarketExposure: marketExposure,
        postTradeTotalExposure: totalExposure,
      };
    }

    const marketAlreadyOpen = marketExposure > 0;

    if (!marketAlreadyOpen && openMarketCount >= input.riskConfig.maxOpenMarkets) {
      return {
        decision: RISK_GATE_DECISIONS.REJECT,
        rejectReason: 'max_open_markets_reached',
        requiresConfirm: false,
        confirmReasons: [],
        anomalyFlags: [],
        adjustedNotional: 0,
        adjustedQuantity: 0,
        postTradeMarketExposure: marketExposure,
        postTradeTotalExposure: totalExposure,
      };
    }

    const adjustedNotional = allowedNotional;
    const scale = adjustedNotional / input.requestedNotional;
    const adjustedQuantity = input.requestedQuantity * scale;
    const postTradeMarketExposure = marketExposure + adjustedNotional;
    const postTradeTotalExposure = totalExposure + adjustedNotional;
    const downgraded = adjustedNotional + 1e-9 < input.requestedNotional;

    const confirmReasons: ConfirmReason[] = [];

    if (adjustedNotional >= equity * toNumber(input.riskConfig.confirmOrderNotionalPct)) {
      confirmReasons.push(CONFIRM_REASONS.ORDER_NOTIONAL_THRESHOLD);
    }

    if (
      postTradeMarketExposure >= equity * toNumber(input.riskConfig.confirmPostTradeMarketExposurePct)
    ) {
      confirmReasons.push(CONFIRM_REASONS.POST_TRADE_MARKET_EXPOSURE);
    }

    if (postTradeTotalExposure >= equity * toNumber(input.riskConfig.confirmPostTradeTotalExposurePct)) {
      confirmReasons.push(CONFIRM_REASONS.POST_TRADE_TOTAL_EXPOSURE);
    }

    if (input.riskLevel === RiskLevel.HIGH) {
      confirmReasons.push(CONFIRM_REASONS.HIGH_RISK_LEVEL);
    }

    if (postTradeMarketExposure >= warnMarketExposure) {
      confirmReasons.push(CONFIRM_REASONS.POST_TRADE_MARKET_EXPOSURE);
    }

    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const recentOrders = await this.prisma.order.findMany({
      where: {
        userId: input.userId,
        createdAt: {
          gte: twoMinutesAgo,
        },
      },
      select: {
        status: true,
      },
    });
    const rejectedCount = recentOrders.filter(
      (order) => order.status === OrderStatus.REJECTED || order.status === OrderStatus.FAILED,
    ).length;
    const rejectRate2m = recentOrders.length > 0 ? rejectedCount / recentOrders.length : 0;

    const authError2m = await this.prisma.signerRequest.count({
      where: {
        userId: input.userId,
        status: SignerRequestStatus.DENIED,
        signedAt: {
          gte: twoMinutesAgo,
        },
        denyReason: {
          contains: 'auth',
          mode: 'insensitive',
        },
      },
    });

    const safetyReserve = Math.max(
      toNumber(input.riskConfig.safetyReserveMin),
      equity * toNumber(input.riskConfig.safetyReservePct),
    );
    const availableBalance = Math.max(0, equity - totalExposure);
    const slippageEstimate = adjustedNotional / Math.max(1, input.topLiquidity);
    const equityDropTodayPct = equity > 0 ? Math.max(0, -totalPnl) / equity : 0;
    const fairProbJumping = Math.abs(input.pFair - input.pMkt) >= toNumber(input.riskConfig.maxJumpPct1m);

    const anomalyFlags: AnomalyFlag[] = [];

    if (input.lastTickAge > input.riskConfig.staleTickSeconds) {
      anomalyFlags.push(ANOMALY_FLAGS.LAST_TICK_AGE);
    }
    if (input.spreadPct > toNumber(input.riskConfig.maxSpreadPct)) {
      anomalyFlags.push(ANOMALY_FLAGS.SPREAD_PCT);
    }
    if (input.jumpPct1m > toNumber(input.riskConfig.maxJumpPct1m) && !fairProbJumping) {
      anomalyFlags.push(ANOMALY_FLAGS.JUMP_PCT_1M);
    }
    if (input.topLiquidity < toNumber(input.riskConfig.minTopLiquidity)) {
      anomalyFlags.push(ANOMALY_FLAGS.TOP_LIQUIDITY);
    }
    if (slippageEstimate > toNumber(input.riskConfig.maxSlippagePct)) {
      anomalyFlags.push(ANOMALY_FLAGS.SLIPPAGE_EST);
    }
    if (rejectRate2m > toNumber(input.riskConfig.maxRejectRate2mPct)) {
      anomalyFlags.push(ANOMALY_FLAGS.REJECT_RATE_2M);
    }
    if (authError2m >= input.riskConfig.maxAuthError2m) {
      anomalyFlags.push(ANOMALY_FLAGS.AUTH_ERROR_2M);
    }
    if (availableBalance < safetyReserve) {
      anomalyFlags.push(ANOMALY_FLAGS.AVAILABLE_BALANCE);
    }
    if (equityDropTodayPct > toNumber(input.riskConfig.maxEquityDropTodayPct)) {
      anomalyFlags.push(ANOMALY_FLAGS.EQUITY_DROP_TODAY);
    }

    if (anomalyFlags.length > 0) {
      confirmReasons.push(CONFIRM_REASONS.ANOMALY_22C);
    }

    return {
      decision: downgraded ? RISK_GATE_DECISIONS.DOWNGRADE : RISK_GATE_DECISIONS.APPROVE,
      rejectReason: null,
      requiresConfirm: confirmReasons.length > 0,
      confirmReasons: unique(confirmReasons),
      anomalyFlags: unique(anomalyFlags),
      adjustedNotional,
      adjustedQuantity,
      postTradeMarketExposure,
      postTradeTotalExposure,
    };
  }

  private async writeRiskDecisionAudit(
    userId: string,
    strategyId: string,
    marketId: string,
    evaluation: RiskGateEvaluation,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId,
        actorType: AuditActorType.SYSTEM,
        action: AuditAction.RISK_GATE_DECISION,
        resourceType: 'strategy',
        resourceId: strategyId,
        metadata: {
          market_id: marketId,
          decision: evaluation.decision,
          reject_reason: evaluation.rejectReason,
          confirm_reasons: evaluation.confirmReasons,
          anomaly_flags: evaluation.anomalyFlags,
          adjusted_notional: evaluation.adjustedNotional,
        } as Prisma.InputJsonObject,
      },
    });
  }

  private async ensureRiskConfig(userId: string, strategyId: string, equityOverride?: number) {
    const existing = await this.prisma.riskConfig.findFirst({
      where: {
        userId,
        strategyId: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (existing) {
      return existing;
    }

    const equity = equityOverride && equityOverride > 0 ? equityOverride : 10_000;

    return this.prisma.riskConfig.create({
      data: {
        userId,
        strategyId,
        equity: toDecimalInput(equity),
      },
    });
  }

  private async loadRiskConfigForStrategy(userId: string, strategyId: string): Promise<RiskConfig> {
    const strategySpecific = await this.prisma.riskConfig.findFirst({
      where: {
        userId,
        strategyId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (strategySpecific) {
      return strategySpecific;
    }

    const userLevel = await this.prisma.riskConfig.findFirst({
      where: {
        userId,
        strategyId: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (userLevel) {
      return userLevel;
    }

    const created = await this.ensureRiskConfig(userId, strategyId);
    this.logger.warn(`Created default risk config for user=${userId}`);
    return created;
  }

  private async pauseStrategyWithReason(strategyId: string, reason: string): Promise<void> {
    const updated = await this.prisma.strategy.updateMany({
      where: {
        id: strategyId,
        status: StrategyStatus.ACTIVE,
      },
      data: {
        status: StrategyStatus.PAUSED,
        pausedReason: reason,
      },
    });

    if (updated.count === 0) {
      return;
    }

    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
      select: {
        userId: true,
      },
    });

    if (!strategy) {
      return;
    }

    await this.prisma.auditLog.create({
      data: {
        userId: strategy.userId,
        actorType: AuditActorType.SYSTEM,
        action: AuditAction.STRATEGY_PAUSE,
        resourceType: 'strategy',
        resourceId: strategyId,
        metadata: {
          reason,
        } as Prisma.InputJsonObject,
      },
    });
  }
}
