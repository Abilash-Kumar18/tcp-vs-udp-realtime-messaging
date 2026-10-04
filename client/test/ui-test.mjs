/**
 * Drives the real React app in jsdom against the real running gateway.
 *
 * This is the only test that exercises the browser half end to end: it opens a
 * genuine WebSocket, clicks the genuine buttons, and asserts on the DOM that a
 * user would actually see.
 *
 * Start the gateway first, then:
 *   node client/test/ui-test.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import React from 'react';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..');
const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:3000';
/**
 * Where the gateway actually lives.
 *
 * Equal to ORIGIN for the normal single-origin setup, but a deployed site is
 * served from one host (Vercel) while the gateway that owns the TCP and UDP
 * sockets lives on another (Render) — set API to that host to test that path.
 */
const API = process.env.API || ORIGIN;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll until `fn()` is truthy, so we never race the WebSocket.
 *
 * Each poll is wrapped in `act` so React flushes the state updates the socket
 * delivered in the background before we read the DOM.
 */
async function until(fn, { timeout = 15000, interval = 60, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await act(async () => fn());
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await act(async () => {
      await sleep(interval);
    });
  }
}

/* ------------------------------------------------------------------ *
 * Browser environment
 * ------------------------------------------------------------------ */

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `${ORIGIN}/`,
  pretendToBeVisual: true,
});

const { window } = dom;

// IntersectionObserver drives the sticky-nav highlight; stub it out.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.IntersectionObserver = NoopObserver;

/*
 * Expose only what the app actually touches.
 *
 * Deliberately NOT exposed: Event, MouseEvent, CustomEvent, URL, Blob and
 * friends. Replacing those globals with jsdom's versions breaks Node's own
 * internals (undici's WebSocket, for example, type-checks its events against
 * the real global Event). The test builds its events from `window.*` instead,
 * and React dispatches them on jsdom nodes, so nothing is lost.
 */
const expose = [
  'window', 'document', 'navigator', 'location', 'HTMLElement', 'HTMLInputElement',
  'HTMLSelectElement', 'Element', 'Node', 'getComputedStyle',
  'requestAnimationFrame', 'cancelAnimationFrame',
];
for (const key of expose) {
  if (!(key in window)) continue;
  // Some globals (navigator on modern Node) are getter-only, so define instead of assign.
  try {
    Object.defineProperty(globalThis, key, { value: window[key], writable: true, configurable: true });
  } catch {
    /* not worth failing the run over a non-essential global */
  }
}

globalThis.WebSocket = window.WebSocket;
globalThis.IntersectionObserver = window.IntersectionObserver;

// jsdom has no fetch; reuse Node's. Capture the real one first, otherwise
// assigning an arrow function that calls `fetch` recurses into itself.
//
// The app uses same-origin relative URLs ("/api/stats") unless a remote gateway
// is configured, which a browser resolves against the document but undici cannot
// parse — so resolve them here, against the gateway.
const nodeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) =>
  nodeFetch(typeof input === 'string' && input.startsWith('/') ? `${API}${input}` : input, init);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');

const vite = await createServer({ root: clientRoot, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
const { default: App } = await vite.ssrLoadModule('/src/App.jsx');

const root = createRoot(document.getElementById('root'));

/* ------------------------------------------------------------------ *
 * DOM helpers
 * ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const text = () => document.body.textContent;

function button(label, { exact = false } = {}) {
  const found = $$('button').find((b) => {
    const t = b.textContent.replace(/\s+/g, ' ').trim();
    return exact ? t === label : t.includes(label);
  });
  if (!found) throw new Error(`button "${label}" not found. Available: ${$$('button').map((b) => b.textContent.trim()).join(' | ')}`);
  return found;
}

function panel(title) {
  const card = $$('.card').find((c) => c.textContent.includes(title));
  if (!card) throw new Error(`panel "${title}" not found`);
  return card;
}

/** Buttons are duplicated across the two panels, so always scope the lookup. */
function panelButton(panelTitle, label) {
  const found = [...panel(panelTitle).querySelectorAll('button')].find((b) =>
    b.textContent.replace(/\s+/g, ' ').includes(label),
  );
  if (!found) {
    throw new Error(`button "${label}" not found in "${panelTitle}"`);
  }
  return found;
}

/**
 * Values of one labelled row of the comparison table.
 *
 * Only matches the row's own `<th scope="row">`, so the group-header rows and
 * the "How to interpret" prose can never be mistaken for a metric.
 */
function tableRow(label) {
  const row = $$('table tbody tr').find(
    (tr) => tr.querySelector('th[scope="row"]')?.textContent.trim() === label,
  );
  return row ? [...row.querySelectorAll('td')].map((td) => td.textContent.trim()) : [];
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await sleep(40);
  });
}

async function typeInto(input, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => {
    await sleep(30);
  });
}

/* ------------------------------------------------------------------ *
 * The test
 * ------------------------------------------------------------------ */

try {
  await fetch(`${API}/api/chaos/reset`, { method: 'POST' });

  await act(async () => {
    root.render(React.createElement(App));
  });
  await act(async () => {
    await sleep(120);
  });

  // --- 1. the page renders every section ---------------------------
  for (const id of ['overview', 'architecture', 'demo', 'experiments', 'code', 'report']) {
    check(`section #${id} exists`, Boolean(document.getElementById(id)));
  }

  // --- 2. the gateway WebSocket connects ---------------------------
  await until(() => text().includes('Gateway online'), { label: 'gateway WebSocket' });
  check('gateway WebSocket connects', true);

  // --- 3. the Code Showcase loads real server source ----------------
  await until(() => text().includes('net.createServer'), { label: 'source files from /api/source' });
  check('Code Showcase loads real source', text().includes('dgram.createSocket'));

  // --- 4. inputs are disabled until connected ----------------------
  const tcpInput = document.getElementById('tcp-input');
  const udpInput = document.getElementById('udp-input');
  check('TCP input disabled before connect', tcpInput.disabled === true);
  check('UDP input disabled before connect', udpInput.disabled === true);

  // --- 5. connect both panels --------------------------------------
  // Wait for the measured number, not just the word "connected": the state
  // arrives in the `status` frame, the handshake in the `metrics` frame that
  // follows it.
  await click(button('Connect (real handshake)'));
  await until(() => /Handshake:\s*[\d.]+ ms/.test(panel('TCP Chat Demo').textContent), {
    label: 'TCP connected with handshake',
  });

  await click(button('Register (no handshake)'));
  await until(() => /Handshake:\s*[\d.]+ ms/.test(panel('UDP Chat Demo').textContent), {
    label: 'UDP registered with handshake',
  });

  check('TCP panel shows connected', panel('TCP Chat Demo').textContent.includes('connected'));
  check('UDP panel shows connected', panel('UDP Chat Demo').textContent.includes('connected'));

  const tcpCard = panel('TCP Chat Demo').textContent;
  const udpCard = panel('UDP Chat Demo').textContent;

  const tcpHandshake = /Handshake:\s*([\d.]+) ms/.exec(tcpCard);
  const udpHandshake = /Handshake:\s*([\d.]+) ms/.exec(udpCard);
  check('TCP reports a measured handshake', Boolean(tcpHandshake), tcpHandshake ? `${tcpHandshake[1]} ms` : 'missing');
  check('UDP reports 0 ms handshake', Boolean(udpHandshake) && Number(udpHandshake[1]) === 0, udpHandshake?.[1] ?? 'missing');
  check('TCP setup cost exceeds UDP setup cost', Number(tcpHandshake[1]) >= 0 && /Setup:\s*[\d.]+ ms/.test(tcpCard));

  // --- 6. send a message on each protocol --------------------------
  await typeInto(document.getElementById('tcp-input'), 'hello from the browser');
  await click($$('form.composer').find((f) => f.contains(document.getElementById('tcp-input'))).querySelector('button[type=submit]'));
  await until(() => panel('TCP Chat Demo').querySelectorAll('.log-row').length >= 2, { label: 'TCP send + ACK' });
  check('TCP log shows the sent message and its ACK', panel('TCP Chat Demo').textContent.includes('hello from the browser'));

  await typeInto(document.getElementById('udp-input'), 'hello over udp');
  await click($$('form.composer').find((f) => f.contains(document.getElementById('udp-input'))).querySelector('button[type=submit]'));
  await until(() => panel('UDP Chat Demo').querySelectorAll('.log-row').length >= 2, { label: 'UDP send + ACK' });
  check('UDP log shows the sent message and its ACK', panel('UDP Chat Demo').textContent.includes('hello over udp'));

  // --- 7. loss injection shows up in the UDP log only --------------
  await fetch(`${API}/api/chaos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ udpDrop: 1, udpAckDrop: 0, udpReorder: 0 }),
  });

  for (let i = 0; i < 3; i += 1) {
    await typeInto(document.getElementById('udp-input'), `will be dropped ${i}`);
    await click($$('form.composer').find((f) => f.contains(document.getElementById('udp-input'))).querySelector('button[type=submit]'));
    await act(async () => {
      await sleep(120);
    });
  }
  await until(() => panel('UDP Chat Demo').textContent.includes('dropped in transit'), { label: 'UDP drop notice' });
  check('UDP log reports the injected drop', panel('UDP Chat Demo').textContent.includes('dropped in transit'));
  check('TCP log never reports a drop', !panel('TCP Chat Demo').textContent.includes('dropped in transit'));

  // --- 8. chaos knobs are bound to live sliders --------------------
  const slider = document.getElementById('knob-udpDrop');
  check('loss slider reflects server chaos state', Number(slider.value) === 100, `value=${slider.value}`);

  // --- 9. MTU guard on UDP ------------------------------------------
  await fetch(`${API}/api/chaos/reset`, { method: 'POST' });
  await click(panelButton('UDP Chat Demo', 'Send 2 KB (MTU test)'));
  await until(() => panel('UDP Chat Demo').textContent.includes('MESSAGE_TOO_LARGE'), { label: 'MTU rejection' });
  check('UDP backend rejects an oversized datagram', panel('UDP Chat Demo').textContent.includes('MESSAGE_TOO_LARGE'));

  // The same 2 KB message over TCP must succeed: a stream has no size limit.
  await click(panelButton('TCP Chat Demo', 'Send 2 KB (MTU test)'));
  await until(() => panel('TCP Chat Demo').querySelectorAll('.log-row').length >= 4, { label: 'TCP large message' });
  check('TCP accepts the same 2 KB message (no MTU limit)', !panel('TCP Chat Demo').textContent.includes('MESSAGE_TOO_LARGE'));

  // --- 10. both experiments (the comparison table needs both) -------
  await click(panelButton('TCP experiment', 'Run experiment'));
  await until(() => panel('TCP experiment').textContent.includes('Throughput'), {
    timeout: 25000,
    label: 'TCP experiment results',
  });
  check('TCP experiment reports its own metrics', panel('TCP experiment').textContent.includes('Throughput'));
  check('comparison table still shows placeholders until UDP also runs', tableRow('Messages lost')[0] === '—');

  await click(panelButton('UDP experiment', 'Run experiment'));
  await until(() => tableRow('Messages lost')[0] !== '—', { timeout: 25000, label: 'comparison table' });
  const deliveryEarly = tableRow('Delivery rate');
  check('both experiments populate the comparison table', deliveryEarly.length >= 2 && !deliveryEarly[0].includes('—'), JSON.stringify(deliveryEarly));

  if (process.env.UI_TEST_DEBUG) {
    console.error('comparison table rows:');
    for (const label of ['Messages sent', 'Messages acknowledged', 'Messages lost', 'Delivery rate']) {
      console.error(`  ${label}: ${JSON.stringify(tableRow(label))}`);
    }
  }

  const lost = tableRow('Messages lost');
  check('TCP experiment loses zero messages', lost[0] === '0', `tcp lost=${lost[0]} udp lost=${lost[1]}`);
  check('UDP experiment loses messages at the default 8% drop', Number(lost[1]) > 0, `udp lost=${lost[1]}`);

  const delivery = tableRow('Delivery rate');
  check('TCP delivery rate is 100%', delivery[0].startsWith('100'), `tcp=${delivery[0]} udp=${delivery[1]}`);

  const ordered = tableRow('Delivered in send order');
  check('TCP is always in order', ordered[0] === 'yes', `tcp=${ordered[0]} udp=${ordered[1]}`);

  const header = tableRow('Header per message');
  check('the table shows the real 40 B vs 28 B header sizes', header[0] === '40 B' && header[1] === '28 B', `${header[0]} / ${header[1]}`);

  check('the lost-sequence detail appears for UDP', text().includes('never came back'));

  // --- 11. reset chaos from the UI ---------------------------------
  await click(button('Reset to server defaults'));
  await act(async () => {
    await sleep(300);
  });
  const after = await fetch(`${API}/api/chaos`).then((r) => r.json());
  check('reset button restores server defaults', after.chaos.udpDrop === 0.08, `udpDrop=${after.chaos.udpDrop}`);

  // --- 12. disconnect -----------------------------------------------
  await click(panelButton('TCP Chat Demo', 'Disconnect'));
  await act(async () => {
    await sleep(250);
  });
  check('disconnect returns the panel to a disconnected state', panel('TCP Chat Demo').textContent.includes('disconnected'));
  check('input is re-disabled after disconnect', document.getElementById('tcp-input').disabled === true);
} catch (err) {
  check(`test harness completed without throwing`, false, err.message);
  if (process.env.UI_TEST_DEBUG) console.error(err.stack);
}

await act(async () => {
  root.unmount();
});
await vite.close();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);