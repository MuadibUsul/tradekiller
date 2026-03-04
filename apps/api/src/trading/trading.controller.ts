import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { StrategyStatus } from '@prisma/client';
import type { WebAccessClaims } from '../auth/auth.types';
import { WebAuthGuard } from '../auth/web-auth.guard';
import { WebUser } from '../auth/web-user.decorator';
import { TradingService } from './trading.service';

interface CreateWhitelistBody {
  market_id?: unknown;
  note?: unknown;
}

interface MockTickBody {
  market_id?: unknown;
  p_mkt?: unknown;
  last_tick_age?: unknown;
  spread_pct?: unknown;
  top_liquidity?: unknown;
  jump_pct_1m?: unknown;
}

interface CreateStrategyBody {
  name?: unknown;
  market_id?: unknown;
  outcome_id?: unknown;
  entry_edge?: unknown;
  order_notional?: unknown;
  p_fair_manual?: unknown;
  activate?: unknown;
  equity?: unknown;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new BadRequestException(`${field} must be a finite number`);
}

@Controller('api')
@UseGuards(WebAuthGuard)
export class TradingController {
  constructor(private readonly tradingService: TradingService) {}

  @Get('whitelist')
  async listWhitelist(@WebUser() user: WebAccessClaims) {
    return this.tradingService.listWhitelist(user.uid);
  }

  @Post('whitelist')
  async createWhitelist(@Body() body: CreateWhitelistBody, @WebUser() user: WebAccessClaims) {
    if (typeof body.market_id !== 'string') {
      throw new BadRequestException('market_id is required');
    }

    if (body.note !== undefined && typeof body.note !== 'string') {
      throw new BadRequestException('note must be a string when provided');
    }

    return this.tradingService.createWhitelist(user.uid, body.market_id, body.note);
  }

  @Get('market/metrics')
  async listMarketMetrics(@WebUser() user: WebAccessClaims) {
    return this.tradingService.listMarketMetrics(user.uid);
  }

  @Post('market/mock-tick')
  async upsertMockTick(@Body() body: MockTickBody, @WebUser() user: WebAccessClaims) {
    if (typeof body.market_id !== 'string') {
      throw new BadRequestException('market_id is required');
    }

    return this.tradingService.upsertMarketMetric(user.uid, {
      market_id: body.market_id,
      p_mkt: asNumber(body.p_mkt, 'p_mkt'),
      last_tick_age: asNumber(body.last_tick_age, 'last_tick_age'),
      spread_pct: asNumber(body.spread_pct, 'spread_pct'),
      top_liquidity: asNumber(body.top_liquidity, 'top_liquidity'),
      jump_pct_1m: asNumber(body.jump_pct_1m, 'jump_pct_1m'),
    });
  }

  @Get('strategies')
  async listStrategies(@WebUser() user: WebAccessClaims) {
    return this.tradingService.listStrategies(user.uid);
  }

  @Post('strategies')
  async createStrategy(@Body() body: CreateStrategyBody, @WebUser() user: WebAccessClaims) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      throw new BadRequestException('name is required');
    }
    if (typeof body.market_id !== 'string') {
      throw new BadRequestException('market_id is required');
    }
    if (typeof body.outcome_id !== 'string') {
      throw new BadRequestException('outcome_id is required');
    }

    return this.tradingService.createMeanRevertStrategy(user.uid, {
      name: body.name,
      market_id: body.market_id,
      outcome_id: body.outcome_id,
      entry_edge: asNumber(body.entry_edge, 'entry_edge'),
      order_notional: asNumber(body.order_notional, 'order_notional'),
      p_fair_manual: asNumber(body.p_fair_manual, 'p_fair_manual'),
      activate: body.activate === undefined ? true : Boolean(body.activate),
      equity: body.equity === undefined ? undefined : asNumber(body.equity, 'equity'),
    });
  }

  @Post('strategies/:id/activate')
  async activateStrategy(@Param('id') strategyId: string, @WebUser() user: WebAccessClaims) {
    return this.tradingService.setStrategyStatus(user.uid, strategyId, StrategyStatus.ACTIVE);
  }

  @Post('strategies/:id/pause')
  async pauseStrategy(@Param('id') strategyId: string, @WebUser() user: WebAccessClaims) {
    return this.tradingService.setStrategyStatus(user.uid, strategyId, StrategyStatus.PAUSED);
  }

  @Post('strategies/run-once')
  async runStrategiesOnce(@WebUser() user: WebAccessClaims) {
    return this.tradingService.runStrategiesOnce(user.uid);
  }

  @Get('orders')
  async listOrders(@WebUser() user: WebAccessClaims) {
    return this.tradingService.listOrders(user.uid);
  }

  @Get('signer/requests')
  async listSignerRequests(@WebUser() user: WebAccessClaims) {
    return this.tradingService.listSignerRequests(user.uid);
  }
}

