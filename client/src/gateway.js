/**
 * Single WebSocket to the Node gateway.
 *
 * The browser cannot open raw TCP/UDP sockets, so the browser <-> gateway hop is
 * WebSocket (which is itself a reliable, ordered TCP stream). Everything shown in
 * the demo *below* that hop travels over a real `net` socket or a real `dgram`
 * socket, which is where the protocol differences actually live.
 */

/**
 * Where the gateway lives.
 *
 * Empty by default, which means "same origin as this page" — correct for
 * `npm run serve` and for the Vite dev proxy. When the two halves are deployed
 * separately (site on Vercel, gateway on Render) set VITE_GATEWAY_URL at build
 * time and every request below is addressed to that host instead. The gateway
 * sends permissive CORS headers, so the cross-origin hop is allowed by design.
 */
const GATEWAY = (import.meta.env.VITE_GATEWAY_URL || '').replace(/\/+$/, '');

/** True when the page is served separately from the gateway. */
export const usingRemoteGateway = GATEWAY.length > 0;

/** Human-readable gateway host, for the status badge. */
export const gatewayLabel = GATEWAY ? GATEWAY.replace(/^https?:\/\//, '') : '';

/** Absolute URL for an API path, honouring the configured gateway. */
export function apiUrl(path) {
  return `${GATEWAY}${path}`;
}

/** WebSocket URL for the gateway. */
function wsUrl() {
  if (GATEWAY) return `${GATEWAY.replace(/^http/, 'ws')}/ws`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

const listeners = new Set();

export function createConnection() {
  const url = wsUrl();
  let ws = null;
  let ready = false;
  let queue = [];
  let retry = 0;
  let closed = false;

  function connect() {
    ws = new WebSocket(url);

    ws.onopen = () => {
      ready = true;
      retry = 0;
      for (const item of queue) ws.send(JSON.stringify(item));
      queue = [];
      emit({ t: 'gateway-status', state: 'online' });
    };

    ws.onmessage = (event) => {
      try {
        emit(JSON.parse(event.data));
      } catch {
        /* ignore malformed frames */
      }
    };

    ws.onclose = () => {
      ready = false;
      emit({ t: 'gateway-status', state: 'offline' });
      if (closed) return;
      retry += 1;
      setTimeout(connect, Math.min(1000 * retry, 5000));
    };

    ws.onerror = () => ws.close();
  }

  connect();

  return {
    send(payload) {
      if (ready) ws.send(JSON.stringify(payload));
      else queue.push(payload);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() {
      closed = true;
      ws?.close();
    },
  };
}

function emit(message) {
  for (const fn of listeners) fn(message);
}

/* ------------------------------------------------------------------ *
 * Chaos knobs -> POST /api/chaos (debounced while dragging a slider)
 * ------------------------------------------------------------------ */

let chaosTimer = null;
let pendingChaos = null;

export function pushChaos(patch) {
  pendingChaos = { ...(pendingChaos ?? {}), ...patch };
  if (chaosTimer) clearTimeout(chaosTimer);
  chaosTimer = setTimeout(async () => {
    const body = pendingChaos;
    pendingChaos = null;
    chaosTimer = null;
    if (!body) return;
    try {
      await fetch(apiUrl('/api/chaos'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      /* the gateway will be retried on the next slider move */
    }
  }, 220);
}

export async function resetChaos() {
  if (chaosTimer) clearTimeout(chaosTimer);
  chaosTimer = null;
  pendingChaos = null;
  const res = await fetch(apiUrl('/api/chaos/reset'), { method: 'POST' });
  return res.json();
}

export async function fetchSource(file) {
  const res = await fetch(apiUrl(`/api/source/${file}`));
  if (!res.ok) throw new Error(`could not load ${file}`);
  return (await res.json()).code;
}

export async function fetchStats() {
  const res = await fetch(apiUrl('/api/stats'));
  if (!res.ok) throw new Error('stats unavailable');
  return res.json();
}