export const PROTO_VER = 1 as const;
export const WS_SIGNER_PATH = '/ws/signer' as const;

export const WS_MESSAGE_TYPES = {
  SIGN_REQUEST: 'SIGN_REQUEST',
  SIGN_RESULT: 'SIGN_RESULT',
  SIGN_DENY: 'SIGN_DENY',
  PING: 'PING',
  PONG: 'PONG',
} as const;

export type WsMessageType = (typeof WS_MESSAGE_TYPES)[keyof typeof WS_MESSAGE_TYPES];

export const WS_CLOSE_CODES = {
  UNAUTHORIZED: 4401,
  FORBIDDEN: 4403,
  INVALID: 4408,
  INTERNAL: 1011,
} as const;

export const DEVICE_ACCESS_TOKEN_ISSUER = 'pm-quant-api' as const;
export const DEVICE_ACCESS_TOKEN_AUDIENCE = 'pm-signer-gateway' as const;

export const DEVICE_SCOPES = {
  WS: 'signer:ws',
  SIGN_RESULT: 'signer:sign_result',
} as const;

export type DeviceScope = (typeof DEVICE_SCOPES)[keyof typeof DEVICE_SCOPES];

export interface DeviceAccessTokenClaims {
  iss: typeof DEVICE_ACCESS_TOKEN_ISSUER;
  aud: typeof DEVICE_ACCESS_TOKEN_AUDIENCE;
  uid: string;
  did: string;
  scope: DeviceScope[];
  exp: number;
  iat?: number;
}
