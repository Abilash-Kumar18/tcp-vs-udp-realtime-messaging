import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { Frame, now, round, HEADER_BYTES } from './protocol.js';
import { ProtocolMetrics } from './metrics.js';
import { log } from './logger.js';

/** Largest UDP payload that fits in a 1500-byte Ethernet MTU. */
export const UDP_MAX_PAYLOAD = 1472;

/**
 * UDP LINK - the gateway's real `dgram` socket to the UDP backend.
 *
 * There is deliberately no `connect()` call and no handshake:
 *   - `setupMs` is just one application round trip for the fake "registration"
 *   - `handshakeMs` is always 0, because no handshake exists to measure
 *   - every `send()` is fire-and-forget; a lost datagram is never noticed
 *     unless the application asks for an ACK (which we do, so that the
 *     difference is measurable - and that ACK can be lost too).
 */
export class UdpLink extends EventEmitter {
  constructor({ host, port, chaos }) {
    super();
    this.proto = 'udp';
    this.host = host;
    this.port = port;
    this.chaos = chaos;

    this.metrics = new ProtocolMetrics('udp');
    this.socket = null;
    this.localPort = null;
    this.opening = null;
    this.sessions = new Map();
    this.inFlight = new Map();
    this.waiters = [];
  }

  get connected() {
    return Boolean(this.socket) && this.sessions.size > 0;
  }

  get sessionCount() {
    return this.sessions.size;
  }

  /** Binding a UDP port is a local operation - it involves no network at all. */
  #openSocket() {
    if (this.opening) return this.opening;

    this.opening = new Promise((resolve, reject) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.socket = socket;

      const fail = (err) => {
        this.opening = null;
        reject(err);
      };
      socket.once('error', fail);

      socket.on('message', (message) => {
        let frame;
        try {
          frame = JSON.parse(message.toString('utf8'));
        } catch {
          this.emit('event', { level: 'warn', kind: 'garbage', ts: now(), text: 'Received a non-JSON datagram' });
          return;
        }
        this.#onFrame(frame);
      });

      socket.on('error', (err) => {
        log.error('udp-link', `socket error: ${err.message}`);
        this.emit('event', { level: 'error', kind: 'socket', ts: now(), text: `Socket error: ${err.message}` });
      });

      // bind() is local bookkeeping. NO SYN, NO SYN-ACK, NO ACK.
      socket.bind(0, this.host, () => {
        socket.removeListener('error', fail);
        this.opening = null;
        this.localPort = socket.address().port;
        this.metrics.markHandshake(0); // connectionless: there is nothing to measure
        this.emit('event', {
          level: 'ok',
          kind: 'handshake',
          ts: now(),
          text: `UDP socket bound to ${this.host}:${this.localPort} — no handshake, no connection`,
          extra: { handshakeMs: 0, headerBytes: HEADER_BYTES.udp, maxPayloadBytes: UDP_MAX_PAYLOAD },
        });

        this.#transmit(Frame.hello('udp'));
        this.#expect('welcome', 5000).then(resolve).catch(reject);
      });
    });

    return this.opening;
  }

  /**
   * "Registering" a UDP client is purely application level: the client sends a
   * REGISTER datagram and the backend remembers the source address. No socket is
   * created, no state is negotiated, and the peer is never contacted first.
   */
  async connectSession(cid, label) {
    const setupStart = performance.now();
    await this.#openSocket();
    const frame = await this.#request(Frame.register('udp', cid, label), 'registered', 5000);

    const setupMs = performance.now() - setupStart;
    this.metrics.markSetup(setupMs);
    this.sessions.set(cid, { cid, label, connectedAt: Date.now(), seq: 0 });

    this.emit('status', {
      proto: 'udp',
      cid,
      state: 'connected',
      setupMs: round(setupMs, 3),
      handshakeMs: 0,
      info: frame.message,
      localPort: this.localPort,
    });
    this.emit('event', {
      level: 'ok',
      kind: 'registered',
      ts: now(),
      text: `Session registered by address (setup ${round(setupMs, 3)} ms, handshake 0 ms)`,
    });

    return { setupMs, handshakeMs: 0, localPort: this.localPort };
  }

  disconnectSession(cid) {
    this.sessions.delete(cid);
    if (this.sessions.size === 0) this.close();
    else this.emit('status', { proto: 'udp', cid, state: 'disconnected' });
  }

  send(cid, text, { run = null, payloadBytes = null } = {}) {
    if (!this.socket) throw new Error('UDP socket is not open');
    const session = this.sessions.get(cid);
    if (!session) throw new Error(`session ${cid} is not registered`);

    const seq = ++session.seq;
    const ts = now();
    const frame = Frame.message('udp', { cid, run, seq, ts, text });
    const bytes = payloadBytes ?? Buffer.byteLength(text ?? '', 'utf8');

    this.#transmit(frame);
    // Unlike TCP there is no kernel guarantee, so the *application* must keep
    // track of what it believes is in flight. This map is our only safety net.
    this.metrics.recordSend({ payloadBytes: bytes });
    this.inFlight.set(`${run}:${seq}`, ts);

    this.emit('event', {
      level: 'out',
      kind: 'message',
      cid,
      seq,
      run,
      ts,
      text,
      payloadBytes: bytes,
      extra: {
        headerBytes: HEADER_BYTES.udp,
        delivery: 'best effort - may be lost, duplicated or reordered',
        datagramBytes: bytes + HEADER_BYTES.udp,
      },
    });

    return seq;
  }

  #onFrame(frame) {
    switch (frame.t) {
      case 'ack': {
        const key = `${frame.run}:${frame.seq}`;
        const sentAt = this.inFlight.get(key);
        const rtt = sentAt != null ? now() - sentAt : null;
        this.inFlight.delete(key);

        this.metrics.recordAck();
        if (rtt != null) this.metrics.rtts.push(rtt);
        if (frame.inOrder === false) this.metrics.recordOutOfOrder();

        this.emit('event', {
          level: 'in',
          kind: 'ack',
          cid: frame.cid,
          seq: frame.seq,
          run: frame.run,
          ts: now(),
          text: `ACK #${frame.seq} (${rtt == null ? 'rtt n/a' : `${round(rtt, 3)} ms`})`,
          rttMs: rtt == null ? null : round(rtt, 3),
          extra: {
            oneWayMs: frame.ts != null ? round(frame.recvTs - frame.ts, 3) : null,
            inOrder: frame.inOrder !== false,
            note: 'This ACK is an extra datagram we paid for ourselves; it can also be lost',
          },
        });
        break;
      }

      case 'drop': {
        this.metrics.recordInjectedDrop();
        this.emit('event', {
          level: frame.phase === 'ack' ? 'warn' : 'error',
          kind: 'drop',
          cid: frame.cid,
          seq: frame.seq,
          run: frame.run,
          ts: now(),
          text: frame.phase === 'ack'
            ? `#${frame.seq} reached the server but its ACK was lost — the client waits forever`
            : `#${frame.seq} was dropped in transit — the client will never know`,
          extra: { phase: frame.phase, reason: frame.reason, simulated: true },
        });
        break;
      }

      case 'error':
        this.emit('event', {
          level: 'error',
          kind: 'server-error',
          seq: frame.seq,
          ts: now(),
          text: `Backend error: ${frame.code}${frame.message ? ` — ${frame.message}` : ''}`,
          extra: { code: frame.code, bytes: frame.bytes },
        });
        break;

      case 'welcome':
      case 'registered':
        this.#settle(frame);
        break;
    }
  }

  #transmit(frame) {
    const payload = Buffer.from(JSON.stringify(frame));
    this.socket.send(payload, 0, payload.length, this.port, this.host, (err) => {
      if (err) this.emit('event', { level: 'error', kind: 'socket', ts: now(), text: `send failed: ${err.message}` });
    });
  }

  #settle(frame) {
    const index = this.waiters.findIndex(
      (w) => w.expectType === frame.t && (!w.cid || w.cid === frame.cid),
    );
    if (index === -1) return;
    const [waiter] = this.waiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(frame);
  }

  #expect(expectType, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error(`timed out waiting for "${expectType}"`));
      }, timeoutMs);
      this.waiters.push({ expectType, cid: null, resolve, reject, timer });
    });
  }

  #request(frame, expectType, timeoutMs) {
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error(`timed out waiting for "${expectType}"`));
      }, timeoutMs);
      this.waiters.push({ expectType, cid: frame.cid, resolve, reject, timer });
    });
    this.#transmit(frame);
    return promise;
  }

  snapshot() {
    return this.metrics.snapshot({
      handshakeCompleted: false,
      sessions: this.sessions.size,
      localPort: this.localPort,
      inFlight: this.inFlight.size,
      maxPayloadBytes: UDP_MAX_PAYLOAD,
    });
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      /* already closed */
    }
    this.socket = null;
    this.localPort = null;
  }
}