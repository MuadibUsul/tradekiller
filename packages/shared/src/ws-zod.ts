import { z } from 'zod';
import { ANOMALY_FLAGS, CONFIRM_REASONS } from './domain';
import { PROTO_VER, WS_MESSAGE_TYPES } from './protocol';

function enumFromConst<T extends Record<string, string>>(values: T) {
  const tuple = Object.values(values) as [T[keyof T], ...T[keyof T][]];
  return z.enum(tuple);
}

const confirmReasonSchema = enumFromConst(CONFIRM_REASONS);
const anomalyFlagSchema = enumFromConst(ANOMALY_FLAGS);

export const signRequestMessageSchema = z.object({
  proto_ver: z.literal(PROTO_VER),
  type: z.literal(WS_MESSAGE_TYPES.SIGN_REQUEST),
  request_id: z.string().min(1),
  expires_at: z.string().datetime({ offset: true }),
  requires_confirm: z.boolean(),
  confirm_reason: z.array(confirmReasonSchema),
  anomaly_flags: z.array(anomalyFlagSchema),
  display: z.record(z.string(), z.unknown()),
  payload: z.record(z.string(), z.unknown()),
  payload_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export const signResultMessageSchema = z.object({
  proto_ver: z.literal(PROTO_VER),
  type: z.literal(WS_MESSAGE_TYPES.SIGN_RESULT),
  request_id: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  device_sig: z.string().nullable(),
  ts: z.string().datetime({ offset: true }),
});

export const signDenyMessageSchema = z.object({
  proto_ver: z.literal(PROTO_VER),
  type: z.literal(WS_MESSAGE_TYPES.SIGN_DENY),
  request_id: z.string().min(1),
  reason: z.string().min(1),
  ts: z.string().datetime({ offset: true }),
});

export const signPingMessageSchema = z.object({
  proto_ver: z.literal(PROTO_VER),
  type: z.literal(WS_MESSAGE_TYPES.PING),
  ts: z.string().datetime({ offset: true }),
});

export const signPongMessageSchema = z.object({
  proto_ver: z.literal(PROTO_VER),
  type: z.literal(WS_MESSAGE_TYPES.PONG),
  ts: z.string().datetime({ offset: true }),
});

export const signerInboundMessageSchema = z.union([
  signResultMessageSchema,
  signDenyMessageSchema,
  signPingMessageSchema,
]);

export const signerOutboundMessageSchema = z.union([signRequestMessageSchema, signPongMessageSchema]);
