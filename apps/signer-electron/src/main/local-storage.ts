import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SignerSettings } from './types';

interface PersistedAuth {
  deviceRefreshToken: string | null;
}

interface PersistedSettings {
  apiBaseUrl: string;
  wsUrl: string;
  confirmOnAnomaly: boolean;
}

const AUTH_FILE = 'device-auth.json';
const SETTINGS_FILE = 'settings.json';

export class LocalStorageService {
  private readonly authPath: string;
  private readonly settingsPath: string;

  constructor(baseDir: string) {
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }

    this.authPath = join(baseDir, AUTH_FILE);
    this.settingsPath = join(baseDir, SETTINGS_FILE);
  }

  loadRefreshToken(): string | null {
    const payload = this.readJson<PersistedAuth>(this.authPath);
    return payload?.deviceRefreshToken ?? null;
  }

  saveRefreshToken(token: string | null): void {
    this.writeJson(this.authPath, {
      deviceRefreshToken: token,
    } satisfies PersistedAuth);
  }

  loadSettings(defaults: SignerSettings): SignerSettings {
    const payload = this.readJson<PersistedSettings>(this.settingsPath);

    if (!payload) {
      return defaults;
    }

    return {
      ...defaults,
      apiBaseUrl: payload.apiBaseUrl || defaults.apiBaseUrl,
      wsUrl: payload.wsUrl || defaults.wsUrl,
      confirmOnAnomaly:
        typeof payload.confirmOnAnomaly === 'boolean'
          ? payload.confirmOnAnomaly
          : defaults.confirmOnAnomaly,
    };
  }

  saveSettings(settings: SignerSettings): void {
    this.writeJson(this.settingsPath, {
      apiBaseUrl: settings.apiBaseUrl,
      wsUrl: settings.wsUrl,
      confirmOnAnomaly: settings.confirmOnAnomaly,
    } satisfies PersistedSettings);
  }

  private readJson<T>(filePath: string): T | null {
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const raw = readFileSync(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private writeJson(filePath: string, payload: unknown): void {
    writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  }
}
