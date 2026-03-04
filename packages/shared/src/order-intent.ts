import type { OrderSide, OrderType, RiskLevel } from './domain';

/**
 * Canonical order intent used as signer payload across services.
 * Decimal values are serialized as strings to keep hashing stable.
 */
export interface OrderIntentCanonical {
  proto_ver: 1;
  request_id: string;
  user_id: string;
  device_id: string;
  strategy_id: string | null;
  market_id: string;
  outcome_id: string;
  side: OrderSide;
  order_type: OrderType;
  quantity: string;
  price: string | null;
  notional: string;
  risk_level: RiskLevel;
  nonce: string;
  created_at: string;
  expires_at: string;
}
