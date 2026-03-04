import type { Bytes32Hex } from './hashing';
import type { OrderIntentCanonical } from './order-intent';
import type { AnomalyFlag, ConfirmReason } from './domain';
import { PROTO_VER, WS_MESSAGE_TYPES } from './protocol';

export interface SignRequestMessage {
  proto_ver: typeof PROTO_VER;
  type: typeof WS_MESSAGE_TYPES.SIGN_REQUEST;
  request_id: string;
  expires_at: string;
  requires_confirm: boolean;
  confirm_reason: ConfirmReason[];
  anomaly_flags: AnomalyFlag[];
  display: Record<string, unknown>;
  payload: OrderIntentCanonical;
  payload_hash: Bytes32Hex;
}

export interface SignResultMessage {
  proto_ver: typeof PROTO_VER;
  type: typeof WS_MESSAGE_TYPES.SIGN_RESULT;
  request_id: string;
  signature: `0x${string}`;
  device_sig: string | null;
  ts: string;
}

export interface SignDenyMessage {
  proto_ver: typeof PROTO_VER;
  type: typeof WS_MESSAGE_TYPES.SIGN_DENY;
  request_id: string;
  reason: string;
  ts: string;
}

export interface SignPingMessage {
  proto_ver: typeof PROTO_VER;
  type: typeof WS_MESSAGE_TYPES.PING;
  ts: string;
}

export interface SignPongMessage {
  proto_ver: typeof PROTO_VER;
  type: typeof WS_MESSAGE_TYPES.PONG;
  ts: string;
}

export type SignerOutboundMessage = SignRequestMessage | SignPongMessage;
export type SignerInboundMessage = SignResultMessage | SignDenyMessage | SignPingMessage;
