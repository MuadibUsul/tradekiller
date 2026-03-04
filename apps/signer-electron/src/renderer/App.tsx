import { useEffect, useMemo, useState } from 'react';
import type { AppState, ConfirmPrompt } from '../main/types';

function defaultState(): AppState {
  return {
    settings: {
      apiBaseUrl: 'http://localhost:4000',
      wsUrl: 'ws://localhost:4100/ws/signer',
      confirmOnAnomaly: true,
      confirmCooldownSeconds: 60,
      heartbeatSeconds: 5,
      refreshLeewaySeconds: 60,
    },
    connected: false,
    refreshTokenStored: false,
    hasKeystore: false,
    keystoreUnlocked: false,
    passwordCached: false,
    accessTokenExpiresAt: null,
    lastError: null,
    deviceId: null,
    userId: null,
    pendingConfirmRequestId: null,
  };
}

function playAlertTone(): void {
  const context = new AudioContext();
  const oscillators = [0, 1, 2].map((index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 700 + index * 120;
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(context.destination);
    const start = context.currentTime + index * 0.18;
    oscillator.start(start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    oscillator.stop(start + 0.17);
    return oscillator;
  });

  void oscillators;
}

export function App() {
  const [state, setState] = useState<AppState>(defaultState);
  const [apiBaseUrl, setApiBaseUrl] = useState('http://localhost:4000');
  const [wsUrl, setWsUrl] = useState('ws://localhost:4100/ws/signer');
  const [confirmOnAnomaly, setConfirmOnAnomaly] = useState(true);
  const [refreshTokenInput, setRefreshTokenInput] = useState('');
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [unlockPasswordInput, setUnlockPasswordInput] = useState('');
  const [denyReason, setDenyReason] = useState('user_denied');
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;

    window.signerApi
      .getState()
      .then((current) => {
        if (!mounted) {
          return;
        }

        setState(current);
        setApiBaseUrl(current.settings.apiBaseUrl);
        setWsUrl(current.settings.wsUrl);
        setConfirmOnAnomaly(current.settings.confirmOnAnomaly);
      })
      .catch(() => undefined);

    const offState = window.signerApi.onState((next) => {
      setState(next);
      setApiBaseUrl(next.settings.apiBaseUrl);
      setWsUrl(next.settings.wsUrl);
      setConfirmOnAnomaly(next.settings.confirmOnAnomaly);
    });

    const offConfirmRequest = window.signerApi.onConfirmRequest((prompt) => {
      setConfirmPrompt(prompt);
      setDenyReason('user_denied');
      playAlertTone();
    });

    const offConfirmCleared = window.signerApi.onConfirmCleared(() => {
      setConfirmPrompt(null);
    });

    return () => {
      mounted = false;
      offState();
      offConfirmRequest();
      offConfirmCleared();
    };
  }, []);

  const accessExpiry = useMemo(() => {
    if (!state.accessTokenExpiresAt) {
      return 'n/a';
    }

    return new Date(state.accessTokenExpiresAt).toLocaleString();
  }, [state.accessTokenExpiresAt]);

  async function withBusy(task: () => Promise<void>) {
    setBusy(true);

    try {
      await task();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <header>
        <h1>PM Quant Local Signer</h1>
        <p>Electron signer for local key custody and WS signing.</p>
      </header>

      <section className="card">
        <h2>Status</h2>
        <p>Connected: {state.connected ? 'YES' : 'NO'}</p>
        <p>User ID: {state.userId ?? 'n/a'}</p>
        <p>Device ID: {state.deviceId ?? 'n/a'}</p>
        <p>Refresh token stored: {state.refreshTokenStored ? 'YES' : 'NO'}</p>
        <p>Keystore: {state.hasKeystore ? (state.keystoreUnlocked ? 'UNLOCKED' : 'LOCKED') : 'MISSING'}</p>
        <p>Password cached: {state.passwordCached ? 'YES' : 'NO'}</p>
        <p>Access token expires: {accessExpiry}</p>
        <p>Last error: {state.lastError ?? 'none'}</p>
      </section>

      <section className="card">
        <h2>Connection Settings</h2>
        <label>
          API Base URL
          <input value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} />
        </label>
        <label>
          WS URL
          <input value={wsUrl} onChange={(event) => setWsUrl(event.target.value)} />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={confirmOnAnomaly}
            onChange={(event) => setConfirmOnAnomaly(event.target.checked)}
          />
          Force confirm when anomaly flags are non-empty
        </label>
        <div className="row">
          <button
            disabled={busy}
            onClick={() =>
              withBusy(async () => {
                await window.signerApi.updateSettings({
                  apiBaseUrl,
                  wsUrl,
                  confirmOnAnomaly,
                });
              })
            }
          >
            Save Settings
          </button>
          <button
            disabled={busy}
            onClick={() =>
              withBusy(async () => {
                await window.signerApi.refreshAndConnect();
              })
            }
          >
            Refresh Access + Connect
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Device Refresh Token (MVP paste)</h2>
        <textarea
          rows={3}
          placeholder="Paste device_refresh_token"
          value={refreshTokenInput}
          onChange={(event) => setRefreshTokenInput(event.target.value)}
        />
        <div className="row">
          <button
            disabled={busy}
            onClick={() =>
              withBusy(async () => {
                await window.signerApi.saveRefreshToken(refreshTokenInput);
              })
            }
          >
            Save Refresh Token
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Keystore</h2>
        <label>
          Private key
          <input
            placeholder="0x..."
            value={privateKeyInput}
            onChange={(event) => setPrivateKeyInput(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={passwordInput}
            onChange={(event) => setPasswordInput(event.target.value)}
          />
        </label>
        <div className="row">
          <button
            disabled={busy}
            onClick={() =>
              withBusy(async () => {
                await window.signerApi.importPrivateKey(privateKeyInput, passwordInput);
                setPasswordInput('');
              })
            }
          >
            Import + Encrypt
          </button>
        </div>

        <label>
          Unlock password
          <input
            type="password"
            value={unlockPasswordInput}
            onChange={(event) => setUnlockPasswordInput(event.target.value)}
          />
        </label>
        <div className="row">
          <button
            disabled={busy}
            onClick={() =>
              withBusy(async () => {
                await window.signerApi.unlockKeystore(unlockPasswordInput);
                setUnlockPasswordInput('');
              })
            }
          >
            Unlock
          </button>
          <button
            disabled={busy}
            onClick={() =>
              withBusy(async () => {
                await window.signerApi.lockKeystore();
              })
            }
          >
            Lock
          </button>
        </div>
      </section>

      {confirmPrompt ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Confirm Sign Request</h2>
            <p>Request ID: {confirmPrompt.requestId}</p>
            <p>Market: {confirmPrompt.marketId}</p>
            <p>Expires: {confirmPrompt.expiresAt}</p>
            <p>requires_confirm: {String(confirmPrompt.requiresConfirm)}</p>
            <p>forced_by_anomaly: {String(confirmPrompt.forcedByAnomaly)}</p>
            <p>confirm_reason: {confirmPrompt.confirmReasons.join(', ') || 'none'}</p>
            <p>anomaly_flags: {confirmPrompt.anomalyFlags.join(', ') || 'none'}</p>
            <p className="hash">payload_hash: {confirmPrompt.payloadHash}</p>

            <label>
              Deny reason
              <input value={denyReason} onChange={(event) => setDenyReason(event.target.value)} />
            </label>

            <div className="row">
              <button
                className="approve"
                onClick={() => {
                  void window.signerApi.approveConfirm(confirmPrompt.requestId);
                }}
              >
                Approve + Sign
              </button>
              <button
                className="deny"
                onClick={() => {
                  void window.signerApi.denyConfirm(confirmPrompt.requestId, denyReason);
                }}
              >
                Deny
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
