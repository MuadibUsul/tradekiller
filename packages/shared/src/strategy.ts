import { z } from 'zod';
import { ANOMALY_FLAGS, CONFIRM_REASONS, RISK_GATE_DECISIONS } from './domain';

function enumFromConst<T extends Record<string, string>>(values: T) {
  const tuple = Object.values(values) as [T[keyof T], ...T[keyof T][]];
  return z.enum(tuple);
}

export const STRATEGY_TYPES = {
  MEAN_REVERT: 'MEAN_REVERT',
} as const;

export type StrategyType = (typeof STRATEGY_TYPES)[keyof typeof STRATEGY_TYPES];

export const FAIR_SOURCES = {
  MANUAL: 'MANUAL',
} as const;

export type FairSource = (typeof FAIR_SOURCES)[keyof typeof FAIR_SOURCES];

export interface MeanRevertStrategyParams {
  type: typeof STRATEGY_TYPES.MEAN_REVERT;
  market_id: string;
  outcome_id: string;
  entry_edge: number;
  order_notional: number;
  fair_source: typeof FAIR_SOURCES.MANUAL;
  p_fair_manual: number;
}

export interface MarketMetricSnapshot {
  user_id: string;
  market_id: string;
  p_mkt: number;
  last_tick_age: number;
  spread_pct: number;
  top_liquidity: number;
  jump_pct_1m: number;
}

export interface RiskGateResult {
  decision: (typeof RISK_GATE_DECISIONS)[keyof typeof RISK_GATE_DECISIONS];
  requires_confirm: boolean;
  confirm_reasons: Array<(typeof CONFIRM_REASONS)[keyof typeof CONFIRM_REASONS]>;
  anomaly_flags: Array<(typeof ANOMALY_FLAGS)[keyof typeof ANOMALY_FLAGS]>;
  reject_reason: string | null;
  downgraded_notional: number | null;
}

export const meanRevertStrategyParamsSchema = z.object({
  type: z.literal(STRATEGY_TYPES.MEAN_REVERT),
  market_id: z.string().min(1),
  outcome_id: z.string().min(1),
  entry_edge: z.number().positive(),
  order_notional: z.number().positive(),
  fair_source: z.literal(FAIR_SOURCES.MANUAL),
  p_fair_manual: z.number().min(0).max(1),
});

export const marketMetricSnapshotSchema = z.object({
  user_id: z.string().min(1),
  market_id: z.string().min(1),
  p_mkt: z.number().positive(),
  last_tick_age: z.number().min(0),
  spread_pct: z.number().min(0),
  top_liquidity: z.number().min(0),
  jump_pct_1m: z.number().min(0),
});

export const riskGateDecisionSchema = enumFromConst(RISK_GATE_DECISIONS);
export const confirmReasonSchema = enumFromConst(CONFIRM_REASONS);
export const anomalyFlagSchema = enumFromConst(ANOMALY_FLAGS);

