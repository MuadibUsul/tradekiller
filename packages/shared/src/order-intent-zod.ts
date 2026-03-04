import { z } from 'zod';
import { ORDER_SIDES, ORDER_TYPES, RISK_LEVELS } from './domain';
import { PROTO_VER } from './protocol';

function enumFromConst<T extends Record<string, string>>(values: T) {
  const tuple = Object.values(values) as [T[keyof T], ...T[keyof T][]];
  return z.enum(tuple);
}

export const orderIntentCanonicalSchema = z.object({
  proto_ver: z.literal(PROTO_VER),
  request_id: z.string().min(1),
  user_id: z.string().min(1),
  device_id: z.string().min(1),
  strategy_id: z.string().nullable(),
  market_id: z.string().min(1),
  outcome_id: z.string().min(1),
  side: enumFromConst(ORDER_SIDES),
  order_type: enumFromConst(ORDER_TYPES),
  quantity: z.string().min(1),
  price: z.string().min(1).nullable(),
  notional: z.string().min(1),
  risk_level: enumFromConst(RISK_LEVELS),
  nonce: z.string().min(1),
  created_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
});

