import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the `server/` folder. */
export const SERVER_ROOT = path.resolve(here, '..');

/** Absolute path to the project root (where README.md lives). */
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function prob(value, fallback) {
  return clamp(num(value, fallback), 0, 1);
}

export const config = {
  /** Host used for every socket in the demo (loopback keeps it dependency-free). */
  host: process.env.HOST || '127.0.0.1',

  /** Browser-facing HTTP + WebSocket server. */
  httpPort: num(process.env.PORT, 3000),

  /** Real TCP backend, created with net.createServer(). */
  tcpPort: num(process.env.TCP_PORT, 4001),

  /** Real UDP backend, created with dgram.createSocket('udp4'). */
  udpPort: num(process.env.UDP_PORT, 4002),

  /** Built client assets are served from here when they exist. */
  clientDist: path.join(PROJECT_ROOT, 'client', 'dist'),

  /** Defaults for the "chaos panel": knobs that make protocol behaviour visible. */
  defaults: {
    /** Probability the UDP backend silently discards an inbound message. */
    udpDrop: prob(process.env.UDP_DROP, 0.08),
    /** Probability the UDP backend discards its own ACK on the way back. */
    udpAckDrop: prob(process.env.UDP_ACK_DROP, 0.08),
    /** Probability an inbound UDP message is delayed so it overtakes the next one. */
    udpReorder: prob(process.env.UDP_REORDER, 0.05),
    /** Extra one-way delay (ms) injected by both backends on every outgoing frame. */
    latencyMs: num(process.env.LATENCY_MS, 0),
    /** Added to the measured TCP connect time to imitate a non-loopback handshake. */
    tcpHandshakeRttMs: num(process.env.TCP_HANDSHAKE_RTT_MS, 0),
    /** How long the gateway waits for outstanding ACKs before declaring loss. */
    ackTimeoutMs: num(process.env.ACK_TIMEOUT_MS, 2500),
    /** Tell the browser *which* frames the UDP simulation dropped (out-of-band telemetry). */
    exposeDrops: true,
  },

  /** Files the Code Showcase is allowed to read and display (whitelisted). */
  sourceFiles: ['tcp-backend.js', 'udp-backend.js', 'tcp-link.js', 'udp-link.js'],
};

export { clamp, prob, num };