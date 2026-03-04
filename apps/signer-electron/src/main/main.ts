import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { SignerRuntime } from './signer-runtime';
import type { ConfirmPrompt } from './types';

const DEV_RENDERER_URL = 'http://localhost:5174';

let mainWindow: BrowserWindow | null = null;
let runtime: SignerRuntime | null = null;

function isDev(): boolean {
  return !app.isPackaged;
}

function sendToRenderer(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(channel, payload);
}

function clearConfirmUi(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setAlwaysOnTop(false);
  sendToRenderer('signer:confirm-cleared', null);
}

function showConfirmUi(prompt: ConfirmPrompt): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  sendToRenderer('signer:confirm-request', prompt);
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: 'PM Quant Signer',
  });

  if (isDev()) {
    await mainWindow.loadURL(DEV_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('signer:get-state', async () => {
    if (!runtime) {
      throw new Error('Runtime not initialized');
    }

    return runtime.getState();
  });

  ipcMain.handle('signer:update-settings', async (_event, payload: unknown) => {
    if (!runtime) {
      throw new Error('Runtime not initialized');
    }

    const update =
      payload && typeof payload === 'object'
        ? (payload as { apiBaseUrl?: string; wsUrl?: string; confirmOnAnomaly?: boolean })
        : {};

    return runtime.updateSettings(update);
  });

  ipcMain.handle('signer:save-refresh-token', async (_event, token: unknown) => {
    if (!runtime) {
      throw new Error('Runtime not initialized');
    }

    const value = typeof token === 'string' ? token : null;
    return runtime.saveRefreshToken(value);
  });

  ipcMain.handle('signer:refresh-and-connect', async () => {
    if (!runtime) {
      throw new Error('Runtime not initialized');
    }

    return runtime.refreshAndConnect();
  });

  ipcMain.handle('signer:import-private-key', async (_event, privateKey: unknown, password: unknown) => {
    if (!runtime) {
      throw new Error('Runtime not initialized');
    }

    if (typeof privateKey !== 'string' || typeof password !== 'string') {
      throw new Error('privateKey and password are required');
    }

    return runtime.importPrivateKey(privateKey, password);
  });

  ipcMain.handle('signer:unlock-keystore', async (_event, password: unknown) => {
    if (!runtime) {
      throw new Error('Runtime not initialized');
    }

    if (typeof password !== 'string') {
      throw new Error('password is required');
    }

    return runtime.unlockKeystore(password);
  });

  ipcMain.handle('signer:lock-keystore', async () => {
    if (!runtime) {
      throw new Error('Runtime not initialized');
    }

    return runtime.lockKeystore();
  });

  ipcMain.handle('signer:confirm-approve', async (_event, requestId: unknown) => {
    if (!runtime || typeof requestId !== 'string') {
      return;
    }

    runtime.confirm(requestId, true);
  });

  ipcMain.handle('signer:confirm-deny', async (_event, requestId: unknown, reason: unknown) => {
    if (!runtime || typeof requestId !== 'string') {
      return;
    }

    runtime.confirm(requestId, false, typeof reason === 'string' ? reason : 'user_denied');
  });
}

app.whenReady().then(async () => {
  runtime = new SignerRuntime(app.getPath('userData'));

  runtime.attachListeners({
    onState: (state) => sendToRenderer('signer:state', state),
    onConfirmPrompt: (prompt) => showConfirmUi(prompt),
    onConfirmCleared: () => clearConfirmUi(),
  });

  registerIpcHandlers();
  await createMainWindow();
  await runtime.start();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  runtime?.dispose();
  runtime = null;
});
