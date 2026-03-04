export const RISK_LEVELS = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
} as const;

export type RiskLevel = (typeof RISK_LEVELS)[keyof typeof RISK_LEVELS];

export const ORDER_SIDES = {
  BUY: 'BUY',
  SELL: 'SELL',
} as const;

export type OrderSide = (typeof ORDER_SIDES)[keyof typeof ORDER_SIDES];

export const ORDER_TYPES = {
  LIMIT: 'LIMIT',
  MARKET: 'MARKET',
} as const;

export type OrderType = (typeof ORDER_TYPES)[keyof typeof ORDER_TYPES];

export const ORDER_STATUSES = {
  DRAFT: 'DRAFT',
  PENDING_SIGN: 'PENDING_SIGN',
  SIGNED: 'SIGNED',
  SUBMITTED: 'SUBMITTED',
  ACK: 'ACK',
  PARTIAL_FILLED: 'PARTIAL_FILLED',
  FILLED: 'FILLED',
  CANCELED: 'CANCELED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;

export type OrderStatus = (typeof ORDER_STATUSES)[keyof typeof ORDER_STATUSES];

export const SIGNER_REQUEST_STATUSES = {
  PENDING: 'PENDING',
  DELIVERED: 'DELIVERED',
  SIGNED: 'SIGNED',
  DENIED: 'DENIED',
  EXPIRED: 'EXPIRED',
  FAILED: 'FAILED',
} as const;

export type SignerRequestStatus =
  (typeof SIGNER_REQUEST_STATUSES)[keyof typeof SIGNER_REQUEST_STATUSES];

export const EXECUTION_STATUSES = {
  PENDING: 'PENDING',
  LOCKED: 'LOCKED',
  ACK: 'ACK',
  FILLED: 'FILLED',
  FAILED: 'FAILED',
} as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[keyof typeof EXECUTION_STATUSES];

export const CONFIRM_REASONS = {
  ORDER_NOTIONAL_THRESHOLD: 'ORDER_NOTIONAL_THRESHOLD',
  POST_TRADE_MARKET_EXPOSURE: 'POST_TRADE_MARKET_EXPOSURE',
  POST_TRADE_TOTAL_EXPOSURE: 'POST_TRADE_TOTAL_EXPOSURE',
  HIGH_RISK_LEVEL: 'HIGH_RISK_LEVEL',
  ANOMALY_22C: 'ANOMALY_22C',
} as const;

export type ConfirmReason = (typeof CONFIRM_REASONS)[keyof typeof CONFIRM_REASONS];

export const ANOMALY_FLAGS = {
  LAST_TICK_AGE: 'LAST_TICK_AGE',
  SPREAD_PCT: 'SPREAD_PCT',
  JUMP_PCT_1M: 'JUMP_PCT_1M',
  TOP_LIQUIDITY: 'TOP_LIQUIDITY',
  SLIPPAGE_EST: 'SLIPPAGE_EST',
  REJECT_RATE_2M: 'REJECT_RATE_2M',
  AUTH_ERROR_2M: 'AUTH_ERROR_2M',
  AVAILABLE_BALANCE: 'AVAILABLE_BALANCE',
  EQUITY_DROP_TODAY: 'EQUITY_DROP_TODAY',
} as const;

export type AnomalyFlag = (typeof ANOMALY_FLAGS)[keyof typeof ANOMALY_FLAGS];

export const RISK_GATE_DECISIONS = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  DOWNGRADE: 'DOWNGRADE',
} as const;

export type RiskGateDecision = (typeof RISK_GATE_DECISIONS)[keyof typeof RISK_GATE_DECISIONS];
