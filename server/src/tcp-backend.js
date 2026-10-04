import net from 'node:net';
import { config } from './config.js';
import { Frame, createFrameDecoder, encodeFrame, now } from './protocol.js';
import { log } from './logger.js';

/**
 * TCP BACKEND  -  node:net
 * ---------------------------------------------------------------------------
 * `net.createServer()` gives us a *connection-oriented*, *reliable*, *ordered*
 * byte-stream server. Three consequences show up directly in this file:
 *
 *  1. Every accepted socket is a long-lived, stateful conversation. We keep a
 *     Map of them so we can serve many clients at once (one socket per client).
 *  2. The kernel guarantees in-order, exactly-once delivery of the byte stream,
 *     so this file never has to add sequence numbers, timeouts or retries.
 *  3. Data arrives as an arbitrary chunk stream, not as messages, so we must
 *     frame it ourselves (newline-delimited JSON). See `createFrameDecoder`.
 */
export function createTcpBackend({ chaos, host = config.host, port = config.tcpPort } = {}) {
  const state = {
    /** One entry per accepted socket == one connected client. */
    connections: new Map(),
    /** Logical sessions (browser panels) multiplexed over those sockets. */
    clients: new Map(),
    nextConnectionId: 1,
    totalFramesIn: 0,
    totalFramesOut: 0,
    startedAt: Date.now(),
  };

  const send = (socket, frame) => {
    socket.write(encodeFrame(frame));
    state.totalFramesOut += 1;
  };

  /** Artificial one-way latency, applied to BOTH protocols for a fair comparison. */
  const withLatency = (fn) => {
    const delay = chaos.values.latencyMs;
    if (delay > 0) setTimeout(fn, delay);
    else fn();
  };

  function handleMessage(ctx, frame) {
    const client = state.clients.get(frame.cid);
    if (!client) {
      // Connection exists, but this logical session was never registered.
      withLatency(() => send(ctx.socket, Frame.error('tcp', { code: 'NOT_REGISTERED', cid: frame.cid, seq: frame.seq })));
      return;
    }

    client.messages += 1;
    client.lastSeen = Date.now();

    // TCP guarantees the byte order, so sequence numbers must arrive ascending.
    // We still *verify* it in the experiment instead of trusting it blindly.
    const inOrder = frame.seq > client.lastSeq;
    client.lastSeq = frame.seq;

    withLatency(() => {
      send(ctx.socket, Frame.ack('tcp', {
        cid: frame.cid,
        run: frame.run ?? null,
        seq: frame.seq,
        ts: frame.ts,          // sender timestamp -> gateway computes the RTT
        recvTs: now(),         // when the TCP backend read the bytes
        replyTs: now(),        // when we handed the ACK to the kernel
        inOrder,
        messageNo: client.messages,
        socketId: ctx.id,
      }));
    });

    if (frame.text) {
      log.trace('tcp', `${frame.cid} #${frame.seq} "${truncate(frame.text)}" -> ACK (conn ${ctx.id})`);
    }
  }

  function handleFrame(ctx, frame) {
    ctx.framesIn += 1;
    state.totalFramesIn += 1;

    switch (frame.t) {
      case 'hello':
        send(ctx.socket, Frame.welcome('tcp', {
          connectionId: ctx.id,
          serverTs: now(),
          peer: state.clients.size,
          message: 'TCP backend ready (net.createServer, byte stream + custom framing)',
        }));
        break;

      case 'register':
        // One TCP socket can carry MANY logical sessions. Because a TCP socket
        // is a single conversation, we need an application level client id (cid)
        // in every frame to know who a message belongs to.
        state.clients.set(frame.cid, {
          cid: frame.cid,
          label: frame.label,
          connectionId: ctx.id,
          registeredAt: Date.now(),
          messages: 0,
          lastSeq: 0,
          lastSeen: Date.now(),
          orderedOk: true,
        });
        ctx.cids.add(frame.cid);
        log.ok('tcp', `registered ${frame.cid} on connection ${ctx.id}`);
        withLatency(() => send(ctx.socket, Frame.registered('tcp', {
          cid: frame.cid,
          connectionId: ctx.id,
          serverTs: now(),
          registeredAt: now(),
          // The 3-way handshake (SYN -> SYN-ACK -> ACK) already completed before
          // this frame could even be written, which is exactly why registering a
          // TCP session costs at least one extra round trip.
          handshakeCompleted: true,
          message: 'Session registered over an already-established TCP connection',
        })));
        break;

      case 'msg':
        handleMessage(ctx, frame);
        break;

      default:
        send(ctx.socket, Frame.error('tcp', { code: 'UNKNOWN_FRAME', received: frame.t }));
    }
  }

  const server = net.createServer((socket) => {
    const id = `conn-${state.nextConnectionId++}`;
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;

    // Disable Nagle's algorithm: without this, small writes can sit in the
    // kernel waiting to be batched, which adds tens of milliseconds of delay.
    socket.setNoDelay(true);

    const ctx = {
      id,
      socket,
      remote,
      acceptedAt: now(),
      connectedAt: Date.now(),
      framesIn: 0,
      cids: new Set(),
      decode: createFrameDecoder((frame) => handleFrame(ctx, frame)),
    };

    state.connections.set(id, ctx);
    log.ok('tcp', `connection ${id} accepted from ${remote} (${state.connections.size} open)`);

    // Raw 'data' chunks are byte-stream fragments, NOT messages.
    socket.on('data', (chunk) => ctx.decode(chunk));

    socket.on('error', (err) => log.error('tcp', `connection ${id} error: ${err.message}`));

    socket.on('close', () => {
      for (const cid of ctx.cids) state.clients.delete(cid);
      state.connections.delete(id);
      log.warn('tcp', `connection ${id} closed (${state.connections.size} open)`);
    });
  });

  server.on('error', (err) => log.error('tcp', `server error: ${err.message}`));

  return {
    proto: 'tcp',
    listen() {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          log.ok('tcp', `TCP backend listening on ${host}:${port} (net.createServer)`);
          resolve({ host, port });
        });
      });
    },
    stats() {
      return {
        proto: 'tcp',
        listening: server.listening,
        address: server.address(),
        uptimeMs: Date.now() - state.startedAt,
        connections: state.connections.size,
        clients: state.clients.size,
        framesIn: state.totalFramesIn,
        framesOut: state.totalFramesOut,
        model: 'connection-oriented, reliable, ordered byte stream',
        sessions: [...state.clients.values()].map((c) => ({
          cid: c.cid,
          label: c.label,
          connectionId: c.connectionId,
          messages: c.messages,
          lastSeq: c.lastSeq,
          orderedOk: c.orderedOk,
        })),
      };
    },
    close() {
      for (const ctx of state.connections.values()) ctx.socket.destroy();
      server.close();
    },
  };
}

function truncate(text, max = 48) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}