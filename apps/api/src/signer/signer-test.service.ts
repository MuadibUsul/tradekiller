import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditAction, AuditActorType, OrderSide, Prisma, SignerRequestStatus } from '@prisma/client';
import {
  ORDER_SIDES,
  ORDER_TYPES,
  PROTO_VER,
  RISK_LEVELS,
  hashOrderIntentCanonical,
  type OrderIntentCanonical,
} from '@pm-quant/shared';
import { PrismaService } from '../prisma.service';

interface CreateTestSignerRequestBody {
  market_id?: unknown;
  outcome_id?: unknown;
  side?: unknown;
  quantity?: unknown;
  price?: unknown;
  requires_confirm?: unknown;
}

function asString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  return fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  return fallback;
}

function normalizeOrderSide(value: unknown): OrderSide {
  if (value === ORDER_SIDES.SELL) {
    return ORDER_SIDES.SELL;
  }

  return ORDER_SIDES.BUY;
}

@Injectable()
export class SignerTestService {
  constructor(private readonly prisma: PrismaService) {}

  async createTestSignerRequest(userId: string, body: CreateTestSignerRequestBody) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
    const requestId = randomUUID();

    const quantity = asString(body.quantity, '10');
    const price = asString(body.price, '0.52');
    const side = normalizeOrderSide(body.side);
    const marketId = asString(body.market_id, 'mock-market-1');
    const outcomeId = asString(body.outcome_id, 'YES');

    const payload: OrderIntentCanonical = {
      proto_ver: PROTO_VER,
      request_id: requestId,
      user_id: userId,
      device_id: 'unassigned',
      strategy_id: null,
      market_id: marketId,
      outcome_id: outcomeId,
      side,
      order_type: ORDER_TYPES.LIMIT,
      quantity,
      price,
      notional: (Number(quantity) * Number(price)).toFixed(6),
      risk_level: RISK_LEVELS.MEDIUM,
      nonce: `nonce-${now.getTime()}`,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    const payloadHash = hashOrderIntentCanonical(payload);

    const signerRequest = await this.prisma.signerRequest.create({
      data: {
        requestId,
        userId,
        deviceId: null,
        status: SignerRequestStatus.PENDING,
        payload: payload as unknown as Prisma.InputJsonObject,
        payloadHash,
        requiresConfirm: asBoolean(body.requires_confirm, false),
        confirmReasons: [],
        anomalyFlags: [],
        display: {
          market_id: marketId,
          outcome_id: outcomeId,
          side,
          quantity,
          price,
        },
        expiresAt,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        actorType: AuditActorType.USER,
        action: AuditAction.SIGNER_REQUEST_CREATE,
        resourceType: 'signer_request',
        resourceId: signerRequest.requestId,
        metadata: {
          created_for: 'milestone-3-test',
        },
      },
    });

    return {
      id: signerRequest.id,
      request_id: signerRequest.requestId,
      status: signerRequest.status,
      expires_at: signerRequest.expiresAt.toISOString(),
      payload_hash: signerRequest.payloadHash,
    };
  }
}
