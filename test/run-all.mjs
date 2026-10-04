/**
 * Runs every suite in this project against a throwaway gateway.
 *
 * Each suite needs a live server (real TCP and UDP sockets, a WebSocket), so this
 * runner starts one on private ports, waits for it to report healthy, runs the
 * suites in order, and shuts it down again — `npm test` therefore works on a
 * clean checkout with nothing else running.
 *
 * If a gateway is *already* listening on the chosen port it is reused as-is and
 * left running, so running the tests never kills someone's dev session.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PORT = process.env.TEST_PORT || '3100';
const TCP_PORT = process.env.TEST_TCP_PORT || '4101';
const UDP_PORT = process.env.TEST_UDP_PORT || '4102';
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * [file, label, extraEnv?]
 *
 * The last suite re-runs the interaction tests in the deployed configuration —
 * the page on one host, the gateway on another — which is what happens once the
 * site is on Vercel and the sockets are on Render.
 */
const SUITES = [
  ['server/test/smoke.mjs', 'backend end-to-end'],
  ['client/test/render-check.mjs', 'client render + highlighter'],
  ['client/test/ui-test.mjs', 'browser interaction (page and gateway on one host)'],
  [
    'client/test/ui-test.mjs',
    'browser interaction (page and gateway on different hosts, as deployed)',
    { VITE_GATEWAY_URL: BASE, ORIGIN: 'https://tcp-vs-udp.vercel.app', API: BASE },
  ],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function healthy() {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Runs one suite to completion; resolves true when it exits 0. */
function run(file, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        BASE,
        ORIGIN: BASE,
        API: BASE,
        TEST_TCP_PORT: TCP_PORT,
        TEST_UDP_PORT: UDP_PORT,
        ...extraEnv,
      },
    });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

let gateway = null;
let ownedGateway = false;
let stopping = false;
let gatewayLog = [];

try {
  if (await healthy()) {
    console.log(`reusing the gateway already listening on ${BASE}\n`);
  } else {
    console.log(`starting a throwaway gateway on ${BASE} (tcp ${TCP_PORT}, udp ${UDP_PORT})…\n`);
    gateway = spawn(process.execPath, [path.join('server', 'src', 'index.js')], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT, TCP_PORT, UDP_PORT },
    });
    ownedGateway = true;
    gateway.stdout.on('data', (chunk) => gatewayLog.push(String(chunk)));
    gateway.stderr.on('data', (chunk) => gatewayLog.push(String(chunk)));
    gateway.on('exit', (code) => {
      // Ignore the exit we cause ourselves when shutting down.
      if (stopping) return;
      console.error(`\nthe gateway exited early with code ${code}:\n${gatewayLog.join('')}`);
      process.exit(1);
    });

    const deadline = Date.now() + 20000;
    while (!(await healthy())) {
      if (Date.now() > deadline) {
        console.error(`the gateway never became healthy:\n${gatewayLog.join('')}`);
        process.exit(1);
      }
      await sleep(200);
    }
  }

  let failed = 0;
  for (const [file, label, extraEnv] of SUITES) {
    console.log(`\n=== ${label} (${file}) ===`);
    if (!(await run(file, extraEnv))) failed += 1;
  }

  if (failed) {
    console.error(`\n${failed} of ${SUITES.length} suite runs failed. Gateway log:\n${gatewayLog.join('')}`);
  } else {
    console.log(`\nall ${SUITES.length} suite runs passed`);
  }
  process.exitCode = failed ? 1 : 0;
} finally {
  if (ownedGateway && gateway) {
    stopping = true;
    gateway.kill();
    // Give it a moment to close its sockets before the parent exits.
    await sleep(300);
  }
}