export const WEB_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const WEB_REFRESH_TOKEN_TTL_DAYS = 30;

export const DEVICE_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const DEVICE_REFRESH_TOKEN_TTL_DAYS = 30;

export const ENROLL_SESSION_TTL_MINUTES = 10;

export function getApiBaseUrl(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:4000';
}

export function getSignerCallbackUri(): string {
  return process.env.SIGNER_CALLBACK_URI ?? 'signer://callback';
}

export function getWebJwtSecret(): string {
  return process.env.WEB_JWT_SECRET ?? 'dev-web-jwt-secret';
}

export function getDeviceJwtSecret(): string {
  const secret = process.env.DEVICE_JWT_SECRET;

  if (secret && secret.trim().length > 0) {
    return secret;
  }

  return 'dev-device-jwt-secret';
}
