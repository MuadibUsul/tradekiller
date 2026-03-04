const WebSocket = require('ws');
const { PROTO_VER, WS_MESSAGE_TYPES } = require('@pm-quant/shared');

const token = process.env.DEVICE_ACCESS_TOKEN;
const baseUrl = process.env.SIGNER_WS_URL || 'ws://localhost:4100/ws/signer';
const clientName = process.env.CLIENT_NAME || 'signer-client';
const autoSign = String(process.env.AUTO_SIGN || 'false').toLowerCase() === 'true';

if (!token) {
  console.error('DEVICE_ACCESS_TOKEN is required');
  process.exit(1);
}

const url = `${baseUrl}?access_token=${encodeURIComponent(token)}`;
const ws = new WebSocket(url);

ws.on('open', () => {
  console.log(`[${clientName}] open ${url}`);

  ws.send(
    JSON.stringify({
      proto_ver: PROTO_VER,
      type: WS_MESSAGE_TYPES.PING,
      ts: new Date().toISOString(),
    }),
  );
});

ws.on('message', (raw) => {
  const text = raw.toString();
  console.log(`[${clientName}] message ${text}`);

  let payload;

  try {
    payload = JSON.parse(text);
  } catch (error) {
    console.error(`[${clientName}] invalid JSON from server`, error);
    return;
  }

  if (autoSign && payload.type === WS_MESSAGE_TYPES.SIGN_REQUEST) {
    const signResult = {
      proto_ver: PROTO_VER,
      type: WS_MESSAGE_TYPES.SIGN_RESULT,
      request_id: payload.request_id,
      signature: `0x${'1'.repeat(130)}`,
      device_sig: null,
      ts: new Date().toISOString(),
    };

    ws.send(JSON.stringify(signResult));
    console.log(`[${clientName}] SIGN_RESULT sent request_id=${payload.request_id}`);
  }
});

ws.on('close', (code, reason) => {
  console.log(`[${clientName}] close code=${code} reason=${reason.toString()}`);
  process.exit(0);
});

ws.on('error', (error) => {
  console.error(`[${clientName}] error`, error);
});
