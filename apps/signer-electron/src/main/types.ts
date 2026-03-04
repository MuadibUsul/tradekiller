export interface SignerSettings {
  apiBaseUrl: string;
  wsUrl: string;
  confirmOnAnomaly: boolean;
  confirmCooldownSeconds: number;
  heartbeatSeconds: number;
  refreshLeewaySeconds: number;
}

export interface AppState {
  settings: SignerSettings;
  connected: boolean;
  refreshTokenStored: boolean;
  hasKeystore: boolean;
  keystoreUnlocked: boolean;
  passwordCached: boolean;
  accessTokenExpiresAt: number | null;
  lastError: string | null;
  deviceId: string | null;
  userId: string | null;
  pendingConfirmRequestId: string | null;
}

export interface ConfirmPrompt {
  requestId: string;
  marketId: string;
  requiresConfirm: boolean;
  forcedByAnomaly: boolean;
  confirmReasons: string[];
  anomalyFlags: string[];
  display: Record<string, unknown>;
  payloadHash: string;
  expiresAt: string;
}
