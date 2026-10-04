import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';

import { config } from './config.js';
import { createChaos } from './chaos.js';
import { createTcpBackend } from './tcp-backend.js';
import { createUdpBackend } from './udp-backend.js';
import { TcpLink } from './tcp-link.js';
import { UdpLink } from './udp-link.js';
import { runExperiment } from './experiment.js';
import { HEADER_BYTES, LINK_BYTES, round } from './protocol.js';
import { log } from './logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ *
 * Boot the two real backends
 * ------------------------------------------------------------------ */

const chaos = createChaos(config.defaults);
const tcpBackend = createTcpBackend({ chaos, host: config.host, port: config.tcpPort });
const udpBackend = createUdpBackend({ chaos, host: config.host, port: config.udpPort });

await Promise.all([tcpBackend.listen(), udpBackend.listen()]);

/* ------------------------------------------------------------------ *
 * Gateway links (the "client" sockets that talk to the backends)
 * ------------------------------------------------------------------ */

const liveLinks = {
  tcp: new TcpLink({ host: config.host, port: config.tcpPort, chaos }),
  udp: new UdpLink({ host: config.host, port: config.udpPort, chaos }),
};

const makeLink = (proto) =>
  proto === 'tcp'
    ? new TcpLink({ host: config.host, port: config.tcpPort, chaos })
    : new UdpLink({ host: config.host, port: config.udpPort, chaos });

/* ------------------------------------------------------------------ *
 * HTTP API
 * ------------------------------------------------------------------ */

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/api/config', (_req, res) => {
  res.json({
    host: config.host,
    httpPort: config.httpPort,
    tcpPort: config.tcpPort,
    udpPort: config.udpPort,
    chaos: chaos.values,
    defaults: chaos.defaults,
    headerBytes: HEADER_BYTES,
    linkBytes: LINK_BYTES,
  });
});

app.get('/api/stats', (_req, res) => {
  res.json({
    tcp: { backend: tcpBackend.stats(), metrics: liveLinks.tcp.snapshot() },
    udp: { backend: udpBackend.stats(), metrics: liveLinks.udp.snapshot() },
    chaos: chaos.values,
    uptimeMs: Math.round(process.uptime() * 1000),
  });
});

app.get('/api/chaos', (_req, res) => res.json({ chaos: chaos.values, defaults: chaos.defaults }));

app.post('/api/chaos', (req, res) => {
  const values = chaos.set(req.body ?? {});
  log.warn('chaos', `udpDrop=${(values.udpDrop * 100).toFixed(0)}% udpAckDrop=${(values.udpAckDrop * 100).toFixed(0)}% udpReorder=${(values.udpReorder * 100).toFixed(0)}% latency=${values.latencyMs}ms handshakeRTT=${values.tcpHandshakeRttMs}ms`);
  broadcast({ t: 'chaos', chaos: values });
  res.json({ chaos: values });
});

app.post('/api/chaos/reset', (_req, res) => {
  const values = chaos.reset();
  broadcast({ t: 'chaos', chaos: values });
  res.json({ chaos: values });
});

app.post('/api/reset/:proto', (req, res) => {
  const link = liveLinks[req.params.proto];
  if (!link) return res.status(400).json({ error: 'unknown protocol' });
  link.metrics.reset();
  res.json({ metrics: link.snapshot() });
});

/** Serve the real backend source so the Code Showcase can never drift. */
app.get('/api/source/:file', (req, res) => {
  const file = path.basename(req.params.file);
  if (!config.sourceFiles.includes(file)) {
    return res.status(404).json({ error: 'file not available', allowed: config.sourceFiles });
  }
  const full = path.join(here, file);
  fs.readFile(full, 'utf8', (err, body) => {
    if (err) return res.status(500).json({ error: err.message });
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      res.type('text/plain').send(body);
      return;
    }
    res.json({ file, language: 'javascript', code: body });
  });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, uptimeMs: Math.round(process.uptime() * 1000) }));

// Serve the production build when it exists (npm run build).
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist));
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
} else {
  app.get('/', (_req, res) => {
    res.type('html').send(`<!doctype html><meta charset="utf-8">
      <title>TCP vs UDP — dev server</title>
      <body style="font:16px/1.6 system-ui;max-width:44rem;margin:4rem auto;padding:0 1.5rem;color:#0f172a">
      <h1>Gateway is running</h1>
      <p>The React app has not been built yet. Either:</p>
      <ul>
        <li><b>Development</b>: run <code>npm run dev</code> from the project root and open
            <a href="http://localhost:5173">http://localhost:5173</a></li>
        <li><b>Production</b>: run <code>npm run serve</code> from the project root, then open
            <a href="http://localhost:${config.httpPort}">http://localhost:${config.httpPort}</a></li>
      </ul>
      <p>API is live at <code>/api/config</code>.</p>`);
  });
}

const server = http.createServer(app);

/* ------------------------------------------------------------------ *
 * WebSocket layer: browser <-> gateway
 * ------------------------------------------------------------------ */

const wss = new WebSocketServer({ server, path: '/ws' });

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(payload) {
  const text = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(text);
  }
}

wss.on('connection', (ws) => {
  ws.peerCount = wss.clients.size;
  ws.sessions = new Set();

  send(ws, {
    t: 'welcome',
    config: {
      host: config.host,
      httpPort: config.httpPort,
      tcpPort: config.tcpPort,
      udpPort: config.udpPort,
    },
    chaos: chaos.values,
    headerBytes: HEADER_BYTES,
  });
  log.http('ws', `browser connected (${wss.clients.size} open)`);

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const { t } = msg;

    if (t === 'connect') {
      const { proto, cid, label } = msg;
      const link = liveLinks[proto];
      if (!link) return send(ws, { t: 'error', proto, cid, text: `unknown protocol "${proto}"` });
      ws.sessions.add(cid);
      try {
        await link.connectSession(cid, label ?? cid);
        send(ws, { t: 'metrics', proto, cid, metrics: link.snapshot() });
        send(ws, { t: 'backend', proto, backend: proto === 'tcp' ? tcpBackend.stats() : udpBackend.stats() });
      } catch (err) {
        send(ws, { t: 'status', proto, cid, state: 'error', text: err.message });
        send(ws, { t: 'error', proto, cid, text: `Could not connect: ${err.message}` });
      }
      return;
    }

    if (t === 'send') {
      const { proto, cid, text } = msg;
      const link = liveLinks[proto];
      if (!link) return;
      try {
        link.send(cid, text);
        send(ws, { t: 'metrics', proto, cid, metrics: link.snapshot() });
      } catch (err) {
        send(ws, { t: 'error', proto, cid, text: err.message });
      }
      return;
    }

    if (t === 'disconnect') {
      const { proto, cid } = msg;
      liveLinks[proto]?.disconnectSession(cid);
      ws.sessions.delete(cid);
      send(ws, { t: 'status', proto, cid, state: 'disconnected' });
      send(ws, { t: 'metrics', proto, cid, metrics: liveLinks[proto].snapshot() });
      return;
    }

    if (t === 'reset') {
      const { proto } = msg;
      liveLinks[proto]?.metrics.reset();
      send(ws, { t: 'metrics', proto, metrics: liveLinks[proto].snapshot() });
      return;
    }

    if (t === 'experiment') {
      await handleExperiment(ws, msg);
      return;
    }

    if (t === 'ping') {
      send(ws, { t: 'pong', ts: Date.now() });
    }
  });

  ws.on('close', () => {
    // Tear down this browser tab's sessions so backends do not leak state.
    for (const cid of ws.sessions) {
      for (const link of Object.values(liveLinks)) {
        if (link.sessions.has(cid)) link.disconnectSession(cid);
      }
    }
    log.http('ws', `browser disconnected (${wss.clients.size} open)`);
  });
});

/**
 * Experiments run on a THROWAWAY link so that:
 *  - the TCP handshake is measured from scratch every time (a fresh socket),
 *  - the live demo session is never disturbed.
 * This also gives the TCP backend a second connection, which is a nice
 * demonstration of how it serves several clients at once.
 */
async function handleExperiment(ws, { proto, n = 100, payloadBytes = 32 }) {
  if (proto !== 'tcp' && proto !== 'udp') return;
  if (ws.runningExperiment) {
    return send(ws, { t: 'experiment-busy', proto, text: 'An experiment is already running.' });
  }

  ws.runningExperiment = true;
  const link = makeLink(proto);
  const cid = `exp-${proto}-${Date.now().toString(36)}`;

  const forward = (ev) => send(ws, { t: 'log', proto, exp: true, ...ev });
  link.on('event', forward);

  try {
    const started = performance.now();
    const { setupMs, handshakeMs } = await link.connectSession(cid, `experiment (${proto})`);
    const connectReport = { setupMs: round(setupMs, 3), handshakeMs: round(handshakeMs, 3) };
    send(ws, { t: 'experiment-progress', proto, phase: 'connected', ...connectReport });

    const report = await runExperiment(link, {
      cid,
      n,
      payloadBytes,
      ackTimeoutMs: chaos.values.ackTimeoutMs,
    });

    send(ws, {
      t: 'experiment-result',
      proto,
      report: { ...report, wallClockMs: round(performance.now() - started, 3) },
    });
    send(ws, { t: 'backend', proto, backend: proto === 'tcp' ? tcpBackend.stats() : udpBackend.stats() });
  } catch (err) {
    send(ws, { t: 'error', proto, cid, text: `Experiment failed: ${err.message}` });
  } finally {
    link.off('event', forward);
    link.close();
    ws.runningExperiment = false;
  }
}

/* ------------------------------------------------------------------ *
 * Route every link event to the browser
 * ------------------------------------------------------------------ */

for (const link of Object.values(liveLinks)) {
  link.on('event', (ev) => broadcast({ t: 'log', proto: link.proto, ...ev }));
  link.on('status', (ev) => broadcast({ t: 'status', ...ev }));
}

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

server.listen(config.httpPort, config.host, () => {
  log.ok('http', `Gateway + website  http://${config.host}:${config.httpPort}`);
  log.info('net', `TCP backend       ${config.host}:${config.tcpPort}  (net.createServer)`);
  log.info('net', `UDP backend       ${config.host}:${config.udpPort}  (dgram.createSocket)`);
});

server.on('error', (err) => log.error('http', `server error: ${err.message}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log.warn('http', 'shutting down…');
    tcpBackend.close();
    udpBackend.close();
    for (const link of Object.values(liveLinks)) link.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}