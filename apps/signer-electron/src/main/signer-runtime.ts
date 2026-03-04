import {
  PROTO_VER,
  WS_MESSAGE_TYPES,
  signRequestMessageSchema,
  signerInboundMessageSchema,
  signerOutboundMessageSchema,
  type SignDenyMessage,
  type SignResultMessage,
} from '@pm-quant/shared';
import WebSocket from 'ws';
import { KeystoreService } from './keystore';
import { LocalStorageService } from './local-storage';
import type { AppState, ConfirmPrompt, SignerSettings } from './types';

const DEFAULT_SETTINGS: SignerSettings = {
  apiBaseUrl: 'http://localhost:4000',
  wsUrl: 'ws://localhost:4100/ws/signer',
  confirmOnAnomaly: true,
  confirmCooldownSeconds: 60,
  heartbeatSeconds: 5,
  refreshLeewaySeconds: 60,
};

interface PendingConfirmation {
  prompt: ConfirmPrompt;
  resolve: (decision: { approve: boolean; reason?: string }) => void;
}

interface RefreshResponse {
  device_access_token: string;
  token_type: string;
  expires_in: number;
}

type InboundSignRequest = ReturnType<typeof signRequestMessageSchema.parse>;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');

  if (parts.length < 2) {
    throw new Error('Invalid JWT format');
  }

  const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
  return JSON.parse(payload) as Record<string, unknown>;
}

function rawDataToString(raw: WebSocket.RawData): string {
  if (typeof raw === 'string') {
    return raw;
  }

  if (Buffer.isBuffer(raw)) {
    return raw.toString('utf8');
  }

  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8');
  }

  return Buffer.from(raw).toString('utf8');
}

export class SignerRuntime {
  private settings: SignerSettings;
  private readonly keystore: KeystoreService;
  private readonly storage: LocalStorageService;

  private ws: WebSocket | null = null;
  private accessToken: string | null = null;
  private accessTokenExpiresAt: number | null = null;
  private deviceId: string | null = null;
  private userId: string | null = null;

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pendingConfirmation: PendingConfirmation | null = null;
  private confirmCooldownByMarket = new Map<string, number>();

  private onState: (state: AppState) => void = () => {};
  private onConfirmPrompt: (prompt: ConfirmPrompt) => void = () => {};
  private onConfirmCleared: () => void = () => {};

  private state: AppState;

  constructor(baseDir: string) {
    this.storage = new LocalStorageService(baseDir);
    this.keystore = new KeystoreService(baseDir);
    this.settings = this.storage.loadSettings(DEFAULT_SETTINGS);

    this.state = {
      settings: this.settings,
      connected: false,
      refreshTokenStored: this.storage.loadRefreshToken() !== null,
      hasKeystore: this.keystore.hasKeystore(),
      keystoreUnlocked: this.keystore.isUnlocked(),
      passwordCached: this.keystore.hasCachedPassword(),
      accessTokenExpiresAt: null,
      lastError: null,
      deviceId: null,
      userId: null,
      pendingConfirmRequestId: null,
    };
  }

  attachListeners(listeners: {
    onState: (state: AppState) => void;
    onConfirmPrompt: (prompt: ConfirmPrompt) => void;
    onConfirmCleared: () => void;
  }): void {
    this.onState = listeners.onState;
    this.onConfirmPrompt = listeners.onConfirmPrompt;
    this.onConfirmCleared = listeners.onConfirmCleared;
    this.emitState();
  }

  getState(): AppState {
    return this.snapshotState();
  }

  updateSettings(update: Partial<Pick<SignerSettings, 'apiBaseUrl' | 'wsUrl' | 'confirmOnAnomaly'>>): AppState {
    this.settings = {
      ...this.settings,
      ...update,
    };

    this.storage.saveSettings(this.settings);
    this.state.settings = this.settings;
    this.emitState();
    return this.snapshotState();
  }

  saveRefreshToken(token: string | null): AppState {
    const normalized = token && token.trim().length > 0 ? token.trim() : null;
    this.storage.saveRefreshToken(normalized);
    this.state.refreshTokenStored = normalized !== null;
    this.emitState();
    return this.snapshotState();
  }

  async importPrivateKey(privateKey: string, password: string): Promise<AppState> {
    await this.keystore.importPrivateKey(privateKey, password);
    this.state.hasKeystore = this.keystore.hasKeystore();
    this.state.keystoreUnlocked = this.keystore.isUnlocked();
    this.emitState();
    return this.snapshotState();
  }

  async unlockKeystore(password: string): Promise<AppState> {
    await this.keystore.unlock(password);
    this.state.keystoreUnlocked = this.keystore.isUnlocked();
    this.emitState();
    return this.snapshotState();
  }

  lockKeystore(): AppState {
    this.keystore.lock();
    this.state.keystoreUnlocked = false;
    this.emitState();
    return this.snapshotState();
  }

  async start(): Promise<void> {
    const refreshToken = this.storage.loadRefreshToken();

    if (refreshToken) {
      try {
        await this.refreshAndConnect();
      } catch (error) {
        this.setLastError((error as Error).message);
      }
    }
  }

  async refreshAndConnect(): Promise<AppState> {
    const refreshToken = this.storage.loadRefreshToken();

    if (!refreshToken) {
      throw new Error('Device refresh token missing. Paste one first.');
    }

    const refresh = await this.refreshAccessToken(refreshToken);
    this.accessToken = refresh.device_access_token;
    this.accessTokenExpiresAt = Date.now() + refresh.expires_in * 1000;
    this.scheduleTokenRefresh();
    this.extractIdentityFromAccessToken(refresh.device_access_token);
    this.emitState();
    this.connectWebSocket();
    return this.snapshotState();
  }

  confirm(requestId: string, approve: boolean, reason?: string): void {
    if (!this.pendingConfirmation || this.pendingConfirmation.prompt.requestId !== requestId) {
      return;
    }

    this.pendingConfirmation.resolve({ approve, reason });
  }

  dispose(): void {
    this.clearTimers();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }

    this.ws = null;
  }

  private async refreshAccessToken(deviceRefreshToken: string): Promise<RefreshResponse> {
    const response = await fetch(`${this.settings.apiBaseUrl}/api/signer/token/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ device_refresh_token: deviceRefreshToken }),
    });

    const payload = (await response.json()) as RefreshResponse | { message?: unknown };

    if (!response.ok) {
      const message =
        typeof payload === 'object' && payload && 'message' in payload
          ? String((payload as { message?: unknown }).message ?? 'refresh failed')
          : 'refresh failed';
      throw new Error(message);
    }

    return payload as RefreshResponse;
  }

  private connectWebSocket(): void {
    if (!this.accessToken) {
      return;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    const url = `${this.settings.wsUrl}?access_token=${encodeURIComponent(this.accessToken)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.state.connected = true;
      this.setLastError(null);
      this.startHeartbeat();
      this.emitState();
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      void this.handleWsMessage(rawDataToString(raw)).catch((error) => {
        this.setLastError((error as Error).message);
      });
    });

    ws.on('close', () => {
      this.state.connected = false;
      this.emitState();
      this.stopHeartbeat();
      this.scheduleReconnect();
    });

    ws.on('error', (error: Error) => {
      this.setLastError(error.message);
    });
  }

  private async handleWsMessage(raw: string): Promise<void> {
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      this.setLastError('Received invalid JSON over WS');
      return;
    }

    const validated = signerOutboundMessageSchema.safeParse(parsed);

    if (!validated.success) {
      this.setLastError('Received invalid WS message shape');
      return;
    }

    if (validated.data.type === WS_MESSAGE_TYPES.PONG) {
      return;
    }

    const request = validated.data;

    if (request.type !== WS_MESSAGE_TYPES.SIGN_REQUEST) {
      return;
    }

    const requestValidation = signRequestMessageSchema.safeParse(request);

    if (!requestValidation.success) {
      this.setLastError('SIGN_REQUEST failed zod validation.');
      return;
    }

    await this.processSignRequest(requestValidation.data);
  }

  private async processSignRequest(message: InboundSignRequest): Promise<void> {
    const payloadMarketId = this.readString(message.payload, 'market_id') ?? 'unknown-market';
    const forceConfirmByAnomaly = this.settings.confirmOnAnomaly && message.anomaly_flags.length > 0;
    const requiresConfirm = message.requires_confirm || forceConfirmByAnomaly;

    if (requiresConfirm) {
      const lastPromptAt = this.confirmCooldownByMarket.get(payloadMarketId) ?? 0;
      const cooldownMs = this.settings.confirmCooldownSeconds * 1000;

      if (Date.now() - lastPromptAt < cooldownMs) {
        await this.sendSignDeny(message.request_id, 'confirm_cooldown_active');
        return;
      }

      this.confirmCooldownByMarket.set(payloadMarketId, Date.now());

      const decision = await this.awaitUserConfirmation(message, payloadMarketId, forceConfirmByAnomaly);

      if (!decision.approve) {
        await this.sendSignDeny(message.request_id, decision.reason ?? 'user_denied');
        return;
      }
    }

    await this.signAndSend(message);
  }

  private awaitUserConfirmation(
    message: InboundSignRequest,
    marketId: string,
    forcedByAnomaly: boolean,
  ): Promise<{ approve: boolean; reason?: string }> {
    if (this.pendingConfirmation) {
      return Promise.resolve({ approve: false, reason: 'confirmation_busy' });
    }

    const prompt: ConfirmPrompt = {
      requestId: message.request_id,
      marketId,
      requiresConfirm: message.requires_confirm,
      forcedByAnomaly,
      confirmReasons: message.confirm_reason,
      anomalyFlags: message.anomaly_flags,
      display: message.display,
      payloadHash: message.payload_hash,
      expiresAt: message.expires_at,
    };

    this.state.pendingConfirmRequestId = message.request_id;
    this.emitState();

    return new Promise<{ approve: boolean; reason?: string }>((resolve) => {
      this.pendingConfirmation = {
        prompt,
        resolve: (decision) => {
          this.pendingConfirmation = null;
          this.state.pendingConfirmRequestId = null;
          this.onConfirmCleared();
          this.emitState();
          resolve(decision);
        },
      };

      this.onConfirmPrompt(prompt);
    });
  }

  private async signAndSend(message: InboundSignRequest): Promise<void> {
    const wallet = this.keystore.getWallet();

    if (!wallet) {
      await this.sendSignDeny(message.request_id, 'keystore_locked');
      return;
    }

    const signature = await wallet.signMessage(message.payload_hash);

    const outbound: SignResultMessage = {
      proto_ver: PROTO_VER,
      type: WS_MESSAGE_TYPES.SIGN_RESULT,
      request_id: message.request_id,
      signature: signature as `0x${string}`,
      device_sig: '',
      ts: new Date().toISOString(),
    };

    const validation = signerInboundMessageSchema.safeParse(outbound);

    if (!validation.success) {
      throw new Error('Internal SIGN_RESULT payload failed zod validation.');
    }

    this.sendWsMessage(validation.data);
  }

  private async sendSignDeny(requestId: string, reason: string): Promise<void> {
    const deny: SignDenyMessage = {
      proto_ver: PROTO_VER,
      type: WS_MESSAGE_TYPES.SIGN_DENY,
      request_id: requestId,
      reason,
      ts: new Date().toISOString(),
    };

    const validation = signerInboundMessageSchema.safeParse(deny);

    if (!validation.success) {
      throw new Error('Internal SIGN_DENY payload failed zod validation.');
    }

    this.sendWsMessage(validation.data);
  }

  private sendWsMessage(message: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.setLastError('WS is not connected.');
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      const ping = {
        proto_ver: PROTO_VER,
        type: WS_MESSAGE_TYPES.PING,
        ts: new Date().toISOString(),
      };

      const validation = signerInboundMessageSchema.safeParse(ping);

      if (!validation.success) {
        this.setLastError('Internal PING payload failed zod validation.');
        return;
      }

      this.sendWsMessage(validation.data);
    }, this.settings.heartbeatSeconds * 1000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleTokenRefresh(): void {
    if (!this.accessTokenExpiresAt) {
      return;
    }

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    const refreshAt = this.accessTokenExpiresAt - this.settings.refreshLeewaySeconds * 1000;
    const delay = Math.max(1000, refreshAt - Date.now());

    this.refreshTimer = setTimeout(() => {
      void this.refreshAndConnect().catch((error) => {
        this.setLastError((error as Error).message);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private scheduleReconnect(): void {
    if (!this.storage.loadRefreshToken()) {
      return;
    }

    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.refreshAndConnect().catch((error) => {
        this.setLastError((error as Error).message);
        this.scheduleReconnect();
      });
    }, 3000);
  }

  private clearTimers(): void {
    this.stopHeartbeat();

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private extractIdentityFromAccessToken(accessToken: string): void {
    try {
      const payload = decodeJwtPayload(accessToken);
      this.deviceId = typeof payload.did === 'string' ? payload.did : null;
      this.userId = typeof payload.uid === 'string' ? payload.uid : null;
      this.state.deviceId = this.deviceId;
      this.state.userId = this.userId;
      this.state.accessTokenExpiresAt = this.accessTokenExpiresAt;
    } catch {
      this.deviceId = null;
      this.userId = null;
      this.state.deviceId = null;
      this.state.userId = null;
    }
  }

  private emitState(): void {
    this.state.settings = this.settings;
    this.state.hasKeystore = this.keystore.hasKeystore();
    this.state.keystoreUnlocked = this.keystore.isUnlocked();
    this.state.passwordCached = this.keystore.hasCachedPassword();
    this.state.refreshTokenStored = this.storage.loadRefreshToken() !== null;
    this.state.accessTokenExpiresAt = this.accessTokenExpiresAt;
    this.state.connected = this.ws?.readyState === WebSocket.OPEN;
    this.onState(this.snapshotState());
  }

  private setLastError(error: string | null): void {
    this.state.lastError = error;
    this.emitState();
  }

  private readString(value: Record<string, unknown>, key: string): string | null {
    const raw = value[key];
    return typeof raw === 'string' ? raw : null;
  }

  private snapshotState(): AppState {
    return {
      ...this.state,
      settings: {
        ...this.state.settings,
      },
    };
  }
}
