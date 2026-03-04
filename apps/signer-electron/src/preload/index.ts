import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, ConfirmPrompt } from '../main/types';

type Unsubscribe = () => void;

function makeSubscription<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('signerApi', {
  getState: (): Promise<AppState> => ipcRenderer.invoke('signer:get-state'),
  updateSettings: (payload: {
    apiBaseUrl?: string;
    wsUrl?: string;
    confirmOnAnomaly?: boolean;
  }): Promise<AppState> => ipcRenderer.invoke('signer:update-settings', payload),
  saveRefreshToken: (token: string): Promise<AppState> =>
    ipcRenderer.invoke('signer:save-refresh-token', token),
  refreshAndConnect: (): Promise<AppState> => ipcRenderer.invoke('signer:refresh-and-connect'),
  importPrivateKey: (privateKey: string, password: string): Promise<AppState> =>
    ipcRenderer.invoke('signer:import-private-key', privateKey, password),
  unlockKeystore: (password: string): Promise<AppState> =>
    ipcRenderer.invoke('signer:unlock-keystore', password),
  lockKeystore: (): Promise<AppState> => ipcRenderer.invoke('signer:lock-keystore'),
  approveConfirm: (requestId: string): Promise<void> =>
    ipcRenderer.invoke('signer:confirm-approve', requestId),
  denyConfirm: (requestId: string, reason: string): Promise<void> =>
    ipcRenderer.invoke('signer:confirm-deny', requestId, reason),
  onState: (listener: (state: AppState) => void): Unsubscribe =>
    makeSubscription<AppState>('signer:state', listener),
  onConfirmRequest: (listener: (prompt: ConfirmPrompt) => void): Unsubscribe =>
    makeSubscription<ConfirmPrompt>('signer:confirm-request', listener),
  onConfirmCleared: (listener: () => void): Unsubscribe =>
    makeSubscription<null>('signer:confirm-cleared', () => listener()),
});
