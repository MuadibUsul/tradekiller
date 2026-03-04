'use client';

import { FormEvent, useMemo, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

interface EnrollResponse {
  enroll_session_id: string;
  code: string;
  state: string;
  expires_at: string;
  oauth_start_url: string;
}

function parseError(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return 'Request failed';
  }

  if ('message' in payload) {
    const message = (payload as { message?: unknown }).message;

    if (typeof message === 'string') {
      return message;
    }

    if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
      return message.join(', ');
    }
  }

  return 'Request failed';
}

export default function HomePage() {
  const [email, setEmail] = useState('trader@example.com');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [loginInfo, setLoginInfo] = useState<LoginResponse | null>(null);
  const [enrollInfo, setEnrollInfo] = useState<EnrollResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [marketId, setMarketId] = useState('market-1');
  const [outcomeId, setOutcomeId] = useState('YES');
  const [strategyName, setStrategyName] = useState('mean-revert-main');
  const [entryEdge, setEntryEdge] = useState('0.03');
  const [orderNotional, setOrderNotional] = useState('120');
  const [pFairManual, setPFairManual] = useState('0.62');

  const [pMkt, setPMkt] = useState('0.52');
  const [lastTickAge, setLastTickAge] = useState('0.5');
  const [spreadPct, setSpreadPct] = useState('0.01');
  const [topLiquidity, setTopLiquidity] = useState('220');
  const [jumpPct1m, setJumpPct1m] = useState('0.01');

  const [lastResult, setLastResult] = useState<unknown>(null);
  const [orders, setOrders] = useState<unknown[]>([]);
  const [requests, setRequests] = useState<unknown[]>([]);

  const isLoggedIn = useMemo(() => accessToken.length > 0, [accessToken]);

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    });

    const payload = (await response.json()) as T | { message?: unknown };

    if (!response.ok) {
      throw new Error(parseError(payload));
    }

    return payload as T;
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const payload = await request<LoginResponse>('/api/auth/dev-login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      setLoginInfo(payload);
      setAccessToken(payload.access_token);
      setRefreshToken(payload.refresh_token);
      setEnrollInfo(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function runAction(action: () => Promise<void>) {
    setError(null);
    setLoading(true);

    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24, maxWidth: 980 }}>
      <h1>PM Quant Dashboard</h1>
      <p>Milestone 5 control panel for auth, strategy/risk, signer requests, and execution.</p>

      <form onSubmit={handleLogin} style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          style={{ padding: 8 }}
        />
        <button type="submit" disabled={loading} style={{ width: 180, padding: 8 }}>
          Dev Login
        </button>
      </form>

      {loginInfo ? (
        <section style={{ marginBottom: 24 }}>
          <h2>Web Session</h2>
          <p>
            <strong>token_type:</strong> {loginInfo.token_type}
          </p>
          <p>
            <strong>expires_in:</strong> {loginInfo.expires_in}s
          </p>
          <p style={{ wordBreak: 'break-all' }}>
            <strong>access_token:</strong> {accessToken}
          </p>
          <p style={{ wordBreak: 'break-all' }}>
            <strong>refresh_token:</strong> {refreshToken}
          </p>
        </section>
      ) : null}

      <section style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
        <h2>Signer Enroll</h2>
        <button
          type="button"
          onClick={() =>
            runAction(async () => {
              const payload = await request<EnrollResponse>('/api/devices/enroll-session', {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                },
                body: JSON.stringify({ device_name: 'Local Signer' }),
              });

              setEnrollInfo(payload);
              setLastResult(payload);
            })
          }
          disabled={!isLoggedIn || loading}
          style={{ width: 220, padding: 8 }}
        >
          Create Enroll Session
        </button>

        {enrollInfo ? (
          <div>
            <p>
              <strong>enroll_session_id:</strong> {enrollInfo.enroll_session_id}
            </p>
            <p>
              <strong>expires_at:</strong> {enrollInfo.expires_at}
            </p>
            <p>
              <a href={enrollInfo.oauth_start_url} target="_blank" rel="noreferrer">
                Open oauth_start_url
              </a>
            </p>
          </div>
        ) : null}
      </section>

      <section style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
        <h2>Market + Strategy Setup</h2>
        <label>
          Market ID
          <input value={marketId} onChange={(event) => setMarketId(event.target.value)} style={{ marginLeft: 8 }} />
        </label>
        <label>
          Outcome ID
          <input value={outcomeId} onChange={(event) => setOutcomeId(event.target.value)} style={{ marginLeft: 8 }} />
        </label>
        <button
          type="button"
          disabled={!isLoggedIn || loading}
          style={{ width: 220, padding: 8 }}
          onClick={() =>
            runAction(async () => {
              const payload = await request('/api/whitelist', {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                },
                body: JSON.stringify({ market_id: marketId }),
              });
              setLastResult(payload);
            })
          }
        >
          Add Whitelist Market
        </button>

        <label>
          Strategy Name
          <input
            value={strategyName}
            onChange={(event) => setStrategyName(event.target.value)}
            style={{ marginLeft: 8 }}
          />
        </label>
        <label>
          Entry Edge
          <input value={entryEdge} onChange={(event) => setEntryEdge(event.target.value)} style={{ marginLeft: 8 }} />
        </label>
        <label>
          Order Notional
          <input
            value={orderNotional}
            onChange={(event) => setOrderNotional(event.target.value)}
            style={{ marginLeft: 8 }}
          />
        </label>
        <label>
          Manual Fair Probability
          <input
            value={pFairManual}
            onChange={(event) => setPFairManual(event.target.value)}
            style={{ marginLeft: 8 }}
          />
        </label>
        <button
          type="button"
          disabled={!isLoggedIn || loading}
          style={{ width: 220, padding: 8 }}
          onClick={() =>
            runAction(async () => {
              const payload = await request('/api/strategies', {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                },
                body: JSON.stringify({
                  name: strategyName,
                  market_id: marketId,
                  outcome_id: outcomeId,
                  entry_edge: Number(entryEdge),
                  order_notional: Number(orderNotional),
                  p_fair_manual: Number(pFairManual),
                  activate: true,
                }),
              });
              setLastResult(payload);
            })
          }
        >
          Create Mean Revert Strategy
        </button>
      </section>

      <section style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
        <h2>Mock Tick + Run Strategy</h2>
        <label>
          p_mkt
          <input value={pMkt} onChange={(event) => setPMkt(event.target.value)} style={{ marginLeft: 8 }} />
        </label>
        <label>
          last_tick_age
          <input
            value={lastTickAge}
            onChange={(event) => setLastTickAge(event.target.value)}
            style={{ marginLeft: 8 }}
          />
        </label>
        <label>
          spread_pct
          <input value={spreadPct} onChange={(event) => setSpreadPct(event.target.value)} style={{ marginLeft: 8 }} />
        </label>
        <label>
          top_liquidity
          <input
            value={topLiquidity}
            onChange={(event) => setTopLiquidity(event.target.value)}
            style={{ marginLeft: 8 }}
          />
        </label>
        <label>
          jump_pct_1m
          <input value={jumpPct1m} onChange={(event) => setJumpPct1m(event.target.value)} style={{ marginLeft: 8 }} />
        </label>
        <button
          type="button"
          disabled={!isLoggedIn || loading}
          style={{ width: 220, padding: 8 }}
          onClick={() =>
            runAction(async () => {
              const payload = await request('/api/market/mock-tick', {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                },
                body: JSON.stringify({
                  market_id: marketId,
                  p_mkt: Number(pMkt),
                  last_tick_age: Number(lastTickAge),
                  spread_pct: Number(spreadPct),
                  top_liquidity: Number(topLiquidity),
                  jump_pct_1m: Number(jumpPct1m),
                }),
              });
              setLastResult(payload);
            })
          }
        >
          Upsert Mock Tick
        </button>
        <button
          type="button"
          disabled={!isLoggedIn || loading}
          style={{ width: 220, padding: 8 }}
          onClick={() =>
            runAction(async () => {
              const payload = await request('/api/strategies/run-once', {
                method: 'POST',
              });
              setLastResult(payload);
            })
          }
        >
          Run Strategy Once
        </button>
      </section>

      <section style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
        <h2>Execution + Safety</h2>
        <button
          type="button"
          disabled={!isLoggedIn || loading}
          style={{ width: 220, padding: 8 }}
          onClick={() =>
            runAction(async () => {
              const payload = await request('/api/execution/run-once', {
                method: 'POST',
              });
              setLastResult(payload);
            })
          }
        >
          Run Execution Once
        </button>
        <button
          type="button"
          disabled={!isLoggedIn || loading}
          style={{ width: 220, padding: 8, background: '#aa1f1f', color: 'white' }}
          onClick={() =>
            runAction(async () => {
              const payload = await request('/api/panic/stop-all', {
                method: 'POST',
              });
              setLastResult(payload);
            })
          }
        >
          Panic Stop All
        </button>
      </section>

      <section style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
        <h2>Dashboard Data</h2>
        <button
          type="button"
          disabled={!isLoggedIn || loading}
          style={{ width: 220, padding: 8 }}
          onClick={() =>
            runAction(async () => {
              const payload = await request<unknown[]>('/api/signer/requests');
              setRequests(payload);
              setLastResult(payload[0] ?? null);
            })
          }
        >
          Refresh Signer Requests
        </button>
        <button
          type="button"
          disabled={!isLoggedIn || loading}
          style={{ width: 220, padding: 8 }}
          onClick={() =>
            runAction(async () => {
              const payload = await request<unknown[]>('/api/orders');
              setOrders(payload);
              setLastResult(payload[0] ?? null);
            })
          }
        >
          Refresh Orders
        </button>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Signer Requests</h2>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(requests, null, 2)}
        </pre>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Orders</h2>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(orders, null, 2)}
        </pre>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Last Result</h2>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(lastResult, null, 2)}
        </pre>
      </section>

      {error ? <p style={{ color: '#b00020', marginTop: 16 }}>{error}</p> : null}
    </main>
  );
}

