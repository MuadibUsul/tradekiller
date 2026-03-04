import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Prisma, RiskLevel, SignerRequestStatus } from '@prisma/client';
import {
  ORDER_SIDES,
  ORDER_TYPES,
  PROTO_VER,
  RISK_LEVELS,
  hashOrderIntentCanonical,
  type OrderIntentCanonical,
} from '@pm-quant/shared';
import { randomUUID } from 'node:crypto';
import type { WebAccessClaims } from '../auth/auth.types';
import { WebAuthGuard } from '../auth/web-auth.guard';
import { WebUser } from '../auth/web-user.decorator';
import { PrismaService } from '../prisma.service';
import { ExecutionWorkerService } from './execution-worker.service';

interface CreateSignedRequestBody {
  market_id?: unknown;
  outcome_id?: unknown;
  notional?: unknown;
  price?: unknown;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

@Controller('api/execution')
@UseGuards(WebAuthGuard)
export class ExecutionController {
  constructor(
    private readonly executionWorker: ExecutionWorkerService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('run-once')
  async runOnce() {
    return this.executionWorker.runOnce();
  }

  @Post('test-signed-request')
  async createTestSignedRequest(
    @Body() body: CreateSignedRequestBody,
    @WebUser() user: WebAccessClaims,
  ) {
    if (typeof body.market_id !== 'string') {
      throw new BadRequestException('market_id is required');
    }

    const requestId = randomUUID();
    const price = asNumber(body.price, 0.52);
    const notional = asNumber(body.notional, 25);
    const quantity = notional / price;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);

    const payload: OrderIntentCanonical = {
      proto_ver: PROTO_VER,
      request_id: requestId,
      user_id: user.uid,
      device_id: 'unassigned',
      strategy_id: null,
      market_id: body.market_id,
      outcome_id: typeof body.outcome_id === 'string' ? body.outcome_id : 'YES',
      side: ORDER_SIDES.BUY,
      order_type: ORDER_TYPES.LIMIT,
      quantity: quantity.toFixed(8),
      price: price.toFixed(6),
      notional: notional.toFixed(6),
      risk_level: RISK_LEVELS.MEDIUM,
      nonce: `nonce-${requestId}`,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    const signerRequest = await this.prisma.signerRequest.create({
      data: {
        requestId,
        userId: user.uid,
        status: SignerRequestStatus.SIGNED,
        payload: payload as unknown as Prisma.InputJsonObject,
        payloadHash: hashOrderIntentCanonical(payload),
        requiresConfirm: false,
        confirmReasons: [],
        anomalyFlags: [],
        display: {
          market_id: payload.market_id,
          notional: payload.notional,
        } as Prisma.InputJsonObject,
        expiresAt,
        signature: '0xtestsignature',
        deviceSig: null,
        signedAt: now,
        respondedAt: now,
        executionStatus: 'PENDING',
      },
    });

    return {
      request_id: signerRequest.requestId,
      signer_request_id: signerRequest.id,
      status: signerRequest.status,
      execution_status: signerRequest.executionStatus,
      risk_level: RiskLevel.MEDIUM,
    };
  }
}

