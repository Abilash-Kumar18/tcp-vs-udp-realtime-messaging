import net from 'node:net';
import { EventEmitter } from 'node:events';
import { Frame, createFrameDecoder, encodeFrame, now, round, HEADER_BYTES, CONNECTION_METADATA_BYTES } from './protocol.js';
import { ProtocolMetrics } from './metrics.js';
import { log } from './logger.js';

/**
 * TCP LINK - the gateway's real `net.Socket` to the TCP backend.
 *
 * This object is the "client" half of the TCP conversation. It owns:
 *   - connection establishment  (net.connect -> 3-way handshake)
 *   - one socket shared by MANY logical browser sessions (each needs a `cid`,
 *     because a TCP socket only ever carries a single conversation)
 *   - metrics: setup time, ACK rate, RTT, ordering, overhead
 */
export class TcpLink extends EventEmitter {
  constructor({ host, port, chaos }) {
    super();
    this.proto = 'tcp';
    this.host = host;
    this.port = port;
    this.chaos = chaos;

    this.metrics = new ProtocolMetrics('tcp');
    this.socket = null;
    this.handshakeMs = 0;
    this.connectionId = null;
    this.opening = null;
    /** cid -> { cid, label, connectedAt, seq } */
    this.sessions = new Map();
    /** seq -> send timestamp, so a late ACK still yields a correct RTT. */
    this.inFlight = new Map();
    this.waiters = [];
  }

  get connected() {
    return Boolean(this.socket) && !this.socket.destroyed && this.sessions.size > 0;
  }

  get sessionCount() {
    return this.sessions.size;
  }

  /* ---------------------------------------------------------------- *
   * Connection establishment
   * ---------------------------------------------------------------- */

  /**
   * Open the TCP socket. `net.connect()` returns immediately; the promise
   * resolves once the kernel has completed SYN -> SYN-ACK -> ACK. That wait is
   * the connection setup cost that UDP never pays.
   */
  #openSocket() {
    if (this.opening) return this.opening;

    this.opening = new Promise((resolve, reject) => {
      const started = performance.now();
      const socket = net.connect({ host: this.host, port: this.port });
      socket.setNoDelay(true); // no Nagle batching -> predictable small-message latency

      const fail = (err) => {
        this.opening = null;
        reject(err);
      };

      socket.once('error', fail);

      socket.once('connect', () => {
        socket.removeListener('error', fail);
        const measured = performance.now() - started;
        this.socket = socket;
        // `tcpHandshakeRttMs` is an explicitly-labelled simulation knob used to
        // imitate a handshake across a real (non-loopback) network.
        this.handshakeMs = measured + this.chaos.values.tcpHandshakeRttMs;
        this.opening = null;

        this.metrics.markHandshake(this.handshakeMs);
        this.emit('event', {
          level: 'ok',
          kind: 'handshake',
          text: `TCP connection established after ${round(measured, 3)} ms measured handshake`
            + (this.chaos.values.tcpHandshakeRttMs
              ? ` (+${this.chaos.values.tcpHandshakeRttMs} ms simulated WAN RTT)`
              : ' (loopback)'),
          extra: {
            handshakeMs: round(this.handshakeMs, 3),
            measuredMs: round(measured, 3),
            simulatedMs: this.chaos.values.tcpHandshakeRttMs,
            headerBytes: HEADER_BYTES.tcp,
            connectionMetadataBytes: CONNECTION_METADATA_BYTES.tcp,
          },
        });

        const ctx = { decode: createFrameDecoder((frame) => this.#onFrame(frame)) };
        socket.on('data', (chunk) => ctx.decode(chunk));

        socket.on('error', (err) => {
          log.error('tcp-link', `socket error: ${err.message}`);
          this.emit('event', { level: 'error', kind: 'socket', text: `Socket error: ${err.message}` });
        });

        socket.on('close', () => {
          log.warn('tcp-link', 'socket closed');
          this.socket = null;
          const cids = [...this.sessions.keys()];
          this.sessions.clear();
          for (const cid of cids) {
            this.emit('status', { proto: 'tcp', cid, state: 'disconnected' });
          }
          this.emit('event', { level: 'warn', kind: 'close', text: 'TCP connection closed by peer' });
        });

        this.#write(Frame.hello('tcp'));
        this.#expect('welcome', 5000)
          .then((frame) => {
            this.connectionId = frame.connectionId;
            this.emit('event', {
              level: 'info',
              kind: 'welcome',
              ts: now(),
              text: frame.message || 'TCP backend connected',
            });
            resolve(frame);
          })
          .catch(reject);
      });
    });

    return this.opening;
  }

  /**
   * Register one logical browser session.
   * Total cost = handshake (1 RTT, already paid once per socket) + this
   * application round trip. The first message therefore cannot be sent until
   * at least two round trips have elapsed.
   */
  async connectSession(cid, label) {
    const setupStart = performance.now();
    await this.#openSocket();
    const frame = await this.#request(Frame.register('tcp', cid, label), 'registered', 5000);

    const setupMs = performance.now() - setupStart;
    this.metrics.markSetup(setupMs);
    this.sessions.set(cid, { cid, label, connectedAt: Date.now(), seq: 0 });

    this.emit('status', {
      proto: 'tcp',
      cid,
      state: 'connected',
      setupMs: round(setupMs, 3),
      handshakeMs: round(this.handshakeMs, 3),
      info: frame.message,
      connectionId: this.connectionId,
    });
    this.emit('event', {
      level: 'ok',
      kind: 'registered',
      text: `Session registered on connection ${this.connectionId} (setup total ${round(setupMs, 3)} ms)`,
    });

    return { setupMs, handshakeMs: this.handshakeMs, connectionId: this.connectionId };
  }

  disconnectSession(cid) {
    this.sessions.delete(cid);
    if (this.sessions.size === 0) this.close();
    else this.emit('status', { proto: 'tcp', cid, state: 'disconnected' });
  }

  /* ---------------------------------------------------------------- *
   * Sending
   * ---------------------------------------------------------------- */

  /**
   * @returns {number} the sequence number used, so the caller can correlate
   */
  send(cid, text, { run = null, payloadBytes = null } = {}) {
    if (!this.socket || this.socket.destroyed) throw new Error('TCP socket is not open');
    const session = this.sessions.get(cid);
    if (!session) throw new Error(`session ${cid} is not registered`);

    const seq = ++session.seq;
    const ts = now();
    const frame = Frame.message('tcp', { cid, run, seq, ts, text });
    const bytes = payloadBytes ?? Buffer.byteLength(text ?? '', 'utf8');

    // Reliable + ordered, so every write is expected to arrive exactly once.
    // No sequence number or retry logic is needed on the receiver: the kernel
    // does all of it (retransmission timer, cumulative acks, window).
    this.#write(frame);
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
          extra: { headerBytes: HEADER_BYTES.tcp, delivery: 'guaranteed, in order' },
    });

    return seq;
  }

  /* ---------------------------------------------------------------- *
   * Receiving
   * ---------------------------------------------------------------- */

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
          text: `ACK #${frame.seq} (${rtt == null ? 'rtt n/a' : `${round(rtt, 3)} ms`})`,
          rttMs: rtt == null ? null : round(rtt, 3),
          ts: now(),
          extra: {
            oneWayMs: frame.ts != null ? round(frame.recvTs - frame.ts, 3) : null,
            inOrder: frame.inOrder !== false,
            connectionId: frame.socketId,
            note: 'TCP acknowledged this segment in the kernel - no app level ACK was needed',
          },
        });
        break;
      }

      case 'error':
        this.emit('event', {
          level: 'error',
          kind: 'server-error',
          seq: frame.seq,
          ts: now(),
          text: `Backend error: ${frame.code}${frame.message ? ` - ${frame.message}` : ''}`,
        });
        break;

      case 'drop':
        // UDP-only telemetry; a TCP backend should never report a drop.
        break;

      case 'welcome':
      case 'registered':
        this.#settle(frame);
        break;
    }
  }

  /* ---------------------------------------------------------------- *
   * Plumbing
   * ---------------------------------------------------------------- */

  #write(frame) {
    this.socket.write(encodeFrame(frame));
  }

  /** Resolve any pending waiter that matches an incoming frame. */
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

  /** Fire a control frame and wait for its matching reply. */
  #request(frame, expectType, timeoutMs) {
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error(`timed out waiting for "${expectType}"`));
      }, timeoutMs);
      this.waiters.push({ expectType, cid: frame.cid, resolve, reject, timer });
    });
    this.#write(frame);
    return promise;
  }

  snapshot() {
    return this.metrics.snapshot({
      handshakeCompleted: true,
      sessions: this.sessions.size,
      connectionId: this.connectionId,
      inFlight: this.inFlight.size,
    });
  }

  close() {
    this.socket?.destroy();
    this.socket = null;
    this.connectionId = null;
  }
}