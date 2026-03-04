import type { AppState, ConfirmPrompt } from '../main/types';

interface SignerApi {
  getState(): Promise<AppState>;
  updateSettings(payload: {
    apiBaseUrl?: string;
    wsUrl?: string;
    confirmOnAnomaly?: boolean;
  }): Promise<AppState>;
  saveRefreshToken(token: string): Promise<AppState>;
  refreshAndConnect(): Promise<AppState>;
  importPrivateKey(privateKey: string, password: string): Promise<AppState>;
  unlockKeystore(password: string): Promise<AppState>;
  lockKeystore(): Promise<AppState>;
  approveConfirm(requestId: string): Promise<void>;
  denyConfirm(requestId: string, reason: string): Promise<void>;
  onState(listener: (state: AppState) => void): () => void;
  onConfirmRequest(listener: (prompt: ConfirmPrompt) => void): () => void;
  onConfirmCleared(listener: () => void): () => void;
}

declare global {
  interface Window {
    signerApi: SignerApi;
  }
}

export {};
