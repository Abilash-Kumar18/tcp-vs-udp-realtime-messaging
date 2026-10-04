/**
 * End-to-end smoke test: exercises the real TCP and UDP sockets, the live demo
 * path and the experiment path. Run with the gateway already listening:
 *
 *   node server/test/smoke.mjs
 */
import { WebSocket } from 'ws';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const TCP_PORT = Number(process.env.TEST_TCP_PORT || 4001);
const UDP_PORT = Number(process.env.TEST_UDP_PORT || 4002);
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openSocket() {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws`);
  const inbox = [];
  const waiters = [];
  let cursor = 0;

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].match(msg)) {
        // Advance the cursor here too, otherwise the next waitFor would rescan
        // from the old position and happily match this same frame again.
        cursor = inbox.length;
        waiters[i].resolve(msg);
        waiters.splice(i, 1);
      }
    }
  });

  /**
   * Waits for a frame that arrives AFTER this call. Without the cursor a
   * repeated waitFor would happily match a stale result from a previous run.
   */
  return {
    ws,
    inbox,
    open: new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    }),
    send: (payload) => ws.send(JSON.stringify(payload)),
    waitFor(match, timeoutMs = 6000) {
      const from = cursor;
      for (let i = from; i < inbox.length; i += 1) {
        if (match(inbox[i])) {
          cursor = i + 1;
          return Promise.resolve(inbox[i]);
        }
      }
      return new Promise((resolve, reject) => {
        const waiter = { match, resolve, from };
        waiters.push(waiter);
        setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index !== -1) waiters.splice(index, 1);
          reject(new Error(`timed out waiting for a matching frame (${inbox.length - from} frames seen)`));
        }, timeoutMs);
      });
    },
  };
}

async function run() {
  // ---- API sanity -------------------------------------------------
  // Ports are configurable, so compare against what the gateway was told to use
  // (test/run-all.mjs moves the whole stack onto private ports).
  const configRes = await fetch(`${BASE}/api/config`).then((r) => r.json());
  check(
    'GET /api/config advertises both backend ports',
    configRes.tcpPort === TCP_PORT && configRes.udpPort === UDP_PORT,
    `tcp ${configRes.tcpPort}/${TCP_PORT} udp ${configRes.udpPort}/${UDP_PORT}`,
  );
  check(
    'GET /api/config reports 40 B TCP vs 28 B UDP headers',
    configRes.headerBytes?.tcp === 40 && configRes.headerBytes?.udp === 28,
    JSON.stringify(configRes.headerBytes),
  );

  const srcRes = await fetch(`${BASE}/api/source/tcp-backend.js`).then((r) => r.json());
  check('GET /api/source/tcp-backend.js', srcRes.code?.includes('net.createServer'), `${srcRes.code?.length} bytes`);
  const badSrc = await fetch(`${BASE}/api/source/config.js`);
  check('source whitelist rejects non-listed files', badSrc.status === 404);

  // ---- zero the loss knobs so the reliability assertion is exact ---
  await fetch(`${BASE}/api/chaos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ udpDrop: 0, udpAckDrop: 0, udpReorder: 0 }),
  });

  const sock = openSocket();
  await sock.open;

  // ================= TCP live demo =================
  sock.send({ t: 'connect', proto: 'tcp', cid: 'tcp-1', label: 'TCP panel' });
  const tcpStatus = await sock.waitFor((m) => m.t === 'status' && m.proto === 'tcp' && m.state === 'connected');
  check('TCP connect -> status connected', true, `setup=${tcpStatus.setupMs}ms handshake=${tcpStatus.handshakeMs}ms`);
  check('TCP handshake measured (> 0)', tcpStatus.handshakeMs > 0, `${tcpStatus.handshakeMs} ms`);

  sock.send({ t: 'send', proto: 'tcp', cid: 'tcp-1', text: 'hello over TCP' });
  const tcpAck = await sock.waitFor((m) => m.t === 'log' && m.proto === 'tcp' && m.kind === 'ack' && m.seq === 1);
  check('TCP message -> ACK', tcpAck.rttMs !== null && tcpAck.rttMs >= 0, `rtt=${tcpAck.rttMs}ms`);
  check('TCP ACK marked in order', tcpAck.extra?.inOrder === true);

  // sending before connect must fail
  sock.send({ t: 'send', proto: 'udp', cid: 'never-registered', text: 'nope' });
  const udpErr = await sock.waitFor((m) => m.t === 'error' && m.proto === 'udp');
  check('sending on an unregistered session errors', true, udpErr.text);

  // ================= UDP live demo =================
  sock.send({ t: 'connect', proto: 'udp', cid: 'udp-1', label: 'UDP panel' });
  const udpStatus = await sock.waitFor((m) => m.t === 'status' && m.proto === 'udp' && m.state === 'connected');
  check('UDP register -> status connected', true, `setup=${udpStatus.setupMs}ms`);
  check('UDP handshake is always 0 ms', udpStatus.handshakeMs === 0, `${udpStatus.handshakeMs} ms`);

  sock.send({ t: 'send', proto: 'udp', cid: 'udp-1', text: 'hello over UDP' });
  const udpAck = await sock.waitFor((m) => m.t === 'log' && m.proto === 'udp' && m.kind === 'ack');
  check('UDP message -> app-level ACK', udpAck.rttMs !== null, `rtt=${udpAck.rttMs}ms`);

  // ================= TCP experiment (lossless) =================
  sock.send({ t: 'experiment', proto: 'tcp', n: 40, payloadBytes: 32 });
  const tcpExp = await sock.waitFor((m) => m.t === 'experiment-result' && m.proto === 'tcp', 15000);
  check('TCP experiment delivered 40/40', tcpExp.report.acked === 40, `acked=${tcpExp.report.acked} lost=${tcpExp.report.lost}`);
  check('TCP experiment stayed in order', tcpExp.report.inOrder === true);
  check('TCP experiment overhead > UDP overhead per message', tcpExp.report.overhead.headerBytes === 40);

  // ================= UDP experiment with 100% loss =================
  await fetch(`${BASE}/api/chaos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ udpDrop: 1, udpAckDrop: 0, udpReorder: 0, ackTimeoutMs: 900 }),
  });
  sock.send({ t: 'experiment', proto: 'udp', n: 25, payloadBytes: 32 });
  const udpExp = await sock.waitFor((m) => m.t === 'experiment-result' && m.proto === 'udp', 15000);
  check('UDP 100% loss -> 0 acked', udpExp.report.acked === 0, `acked=${udpExp.report.acked} lost=${udpExp.report.lost}`);
  check('UDP 100% loss -> every seq reported lost', udpExp.report.lostSeqs.length === 25);
  check('UDP overhead per message is 28 bytes', udpExp.report.overhead.headerBytes === 28);

  // ================= UDP experiment with 50% loss =================
  await fetch(`${BASE}/api/chaos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ udpDrop: 0.5, udpAckDrop: 0.5, udpReorder: 0, ackTimeoutMs: 1200 }),
  });
  sock.send({ t: 'experiment', proto: 'udp', n: 60, payloadBytes: 32 });
  const udpExp2 = await sock.waitFor((m) => m.t === 'experiment-result' && m.proto === 'udp', 15000);
  const rate = udpExp2.report.deliveryRate;
  check('UDP 50%+50% loss -> partial delivery', udpExp2.report.acked > 0 && udpExp2.report.acked < 60, `delivery=${rate}% n=${udpExp2.report.n} run=${udpExp2.report.run}`);
  check('UDP 50% report is a distinct run', udpExp2.report.run !== udpExp.report.run, `${udpExp.report.run} vs ${udpExp2.report.run}`);

  // ---- restore defaults -------------------------------------------
  await fetch(`${BASE}/api/chaos/reset`, { method: 'POST' });

  const stats = await fetch(`${BASE}/api/stats`).then((r) => r.json());
  check('GET /api/stats', stats.tcp && stats.udp, `tcp conns=${stats.tcp.backend.connections} udp clients=${stats.udp.backend.clients}`);

  sock.ws.close();
  await sleep(300);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((err) => {
  console.error('SMOKE TEST CRASHED:', err);
  process.exit(1);
});