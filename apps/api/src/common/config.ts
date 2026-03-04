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
  const secret = process.env.WEB_JWT_SECRET ?? 'dev-web-jwt-secret';

  if (process.env.NODE_ENV === 'production' && secret === 'dev-web-jwt-secret') {
    throw new Error('WEB_JWT_SECRET must be set to a non-default value in production.');
  }

  return secret;
}

export function getDeviceJwtSecret(): string {
  const secret = process.env.DEVICE_JWT_SECRET;

  if (secret && secret.trim().length > 0) {
    if (process.env.NODE_ENV === 'production' && secret === 'dev-device-jwt-secret') {
      throw new Error('DEVICE_JWT_SECRET must be set to a non-default value in production.');
    }
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DEVICE_JWT_SECRET must be set in production.');
  }

  return 'dev-device-jwt-secret';
}
