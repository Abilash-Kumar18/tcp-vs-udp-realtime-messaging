import dgram from 'node:dgram';
import { config } from './config.js';
import { Frame, now } from './protocol.js';
import { log } from './logger.js';

/**
 * UDP BACKEND  -  node:dgram
 * ---------------------------------------------------------------------------
 * `dgram.createSocket('udp4')` is *connectionless*. Nothing is set up before the
 * first byte: we simply hand a datagram to the IP layer. Consequences:
 *
 *  1. NO handshake, NO session object. A "registered" client is only an entry in
 *     a Map keyed by cid, pointing at the sender's address+port.
 *  2. NO reliability. The kernel gives us best-effort delivery; if we want ACKs
 *     we must build them ourselves as *another datagram*, which can itself be
 *     lost. That is exactly what `udpAckDrop` simulates below.
 *  3. NO ordering. Datagrams can overtake each other, so `udpReorder` delays a
 *     few of them on purpose.
 *  4. MTU-bound: one message == one datagram, so a big message must be split or
 *     dropped. Try sending a 2000 character message and watch the log.
 */
export function createUdpBackend({ chaos, host = config.host, port = config.udpPort } = {}) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  /** cid -> { cid, addr, rinfo, messages, lastSeq, orderedOk } */
  const clients = new Map();
  const stats = {
    framesIn: 0,
    framesOut: 0,
    datagramsDropped: 0,
    acksDropped: 0,
    reordered: 0,
    startedAt: Date.now(),
  };

  const withLatency = (fn) => {
    const delay = chaos.values.latencyMs;
    if (delay > 0) setTimeout(fn, delay);
    else fn();
  };

  /** Fire-and-forget: no return value, no delivery guarantee, no error callback. */
  function send(addr, frame, { onError } = {}) {
    const payload = Buffer.from(JSON.stringify(frame));
    stats.framesOut += 1;
    socket.send(payload, 0, payload.length, addr.port, addr.address, (err) => {
      if (err && onError) onError(err);
    });
  }

  /**
   * Application-level ACK.
   *
   * TCP already acknowledges every segment for free inside the kernel. With UDP
   * we must spend an entire extra datagram on it - and that datagram can be lost
   * too, which is precisely why real UDP apps add sequence numbers, timers and
   * retransmission on top.
   */
  function sendAck(addr, frame) {
    if (chaos.roll(chaos.values.udpAckDrop)) {
      stats.acksDropped += 1;
      if (chaos.values.exposeDrops) {
        send(addr, Frame.drop('udp', {
          cid: frame.cid,
          run: frame.run ?? null,
          seq: frame.seq,
          phase: 'ack',
          ts: frame.ts,
          sentAt: now(),
          reason: `simulated loss: ACK discarded with probability ${(chaos.values.udpAckDrop * 100).toFixed(0)}%`,
        }));
      }
      log.warn('udp', `ACK for #${frame.seq} -> ${addr.port} DISCARDED (simulated)`);
      return;
    }
    send(addr, Frame.ack('udp', {
      cid: frame.cid,
      run: frame.run ?? null,
      seq: frame.seq,
      ts: frame.ts,
      recvTs: frame.__recvTs,
      replyTs: now(),
      inOrder: frame.__inOrder,
      messageNo: frame.__messageNo,
    }));
  }

  function handleMessage(addr, frame) {
    const client = clients.get(frame.cid);
    if (!client) {
      send(addr, Frame.error('udp', { code: 'NOT_REGISTERED', cid: frame.cid, seq: frame.seq }));
      return;
    }

    // --- loss injection: the datagram simply never gets processed ----------
    if (chaos.roll(chaos.values.udpDrop)) {
      stats.datagramsDropped += 1;
      log.warn('udp', `#${frame.seq} from cid=${frame.cid} SILENTLY DROPPED (simulated)`);
      if (chaos.values.exposeDrops) {
        send(addr, Frame.drop('udp', {
          cid: frame.cid,
          run: frame.run ?? null,
          seq: frame.seq,
          phase: 'data',
          ts: frame.ts,
          sentAt: now(),
          reason: `simulated loss: datagram discarded with probability ${(chaos.values.udpDrop * 100).toFixed(0)}%`,
        }));
      }
      return;
    }

    client.messages += 1;
    client.lastSeen = Date.now();
    const inOrder = frame.seq > client.lastSeq;
    if (!inOrder) client.orderedOk = false;
    client.lastSeq = Math.max(client.lastSeq, frame.seq);

    const reply = { ...frame, __recvTs: now(), __inOrder: inOrder, __messageNo: client.messages };

    // --- reordering injection: hold this datagram back so a later one wins --
    if (chaos.roll(chaos.values.udpReorder)) {
      stats.reordered += 1;
      const jitter = 6 + Math.floor(Math.random() * 10);
      log.warn('udp', `#${frame.seq} DELAYED ${jitter}ms to force out-of-order delivery`);
      setTimeout(() => withLatency(() => sendAck(addr, reply)), jitter);
      return;
    }

    withLatency(() => sendAck(addr, reply));
    if (frame.text) log.trace('udp', `${frame.cid} #${frame.seq} "${truncate(frame.text)}" -> ACK`);
  }

  function handleFrame(addr, frame, message) {
    stats.framesIn += 1;

    switch (frame.t) {
      case 'hello':
        send(addr, Frame.welcome('udp', {
          serverTs: now(),
          peer: clients.size,
          localPort: socket.address().port,
          message: 'UDP backend ready (dgram.createSocket, one datagram per message)',
        }));
        break;

      case 'register': {
        // No handshake happened. We just remember where this cid writes from.
        const key = `${addr.address}:${addr.port}`;
        clients.set(frame.cid, {
          cid: frame.cid,
          label: frame.label,
          addr: { address: addr.address, port: addr.port },
          key,
          messages: 0,
          lastSeq: 0,
          orderedOk: true,
          registeredAt: Date.now(),
          lastSeen: Date.now(),
        });
        log.ok('udp', `registered ${frame.cid} @ ${key} (no handshake, no socket)`);
        withLatency(() => send(addr, Frame.registered('udp', {
          cid: frame.cid,
          serverTs: now(),
          registeredAt: now(),
          handshakeCompleted: false,
          message: 'Session registered - UDP never established a connection',
        })));
        break;
      }

      case 'msg':
        // A datagram larger than the path MTU simply cannot be delivered.
        if (message.length > 1472) {
          send(addr, Frame.error('udp', {
            code: 'MESSAGE_TOO_LARGE',
            cid: frame.cid,
            seq: frame.seq,
            bytes: message.length,
            message: 'Datagram exceeds the 1472-byte UDP payload budget of a 1500-byte MTU link',
          }));
          log.error('udp', `oversized datagram (${message.length} B) rejected for ${frame.cid}`);
          return;
        }
        handleMessage(addr, frame);
        break;

      default:
        send(addr, Frame.error('udp', { code: 'UNKNOWN_FRAME', received: frame.t }));
    }
  }

  socket.on('message', (message, rinfo) => {
    let frame;
    try {
      frame = JSON.parse(message.toString('utf8'));
    } catch {
      log.error('udp', `malformed datagram from ${rinfo.address}:${rinfo.port}`);
      return;
    }
    try {
      handleFrame({ address: rinfo.address, port: rinfo.port }, frame, message);
    } catch (err) {
      log.error('udp', `handler error: ${err.message}`);
    }
  });

  socket.on('error', (err) => log.error('udp', `socket error: ${err.message}`));

  /**
   * UDP has no connection close event, so a client that simply disappears
   * (closed tab, crashed process) is invisible to us. We expire the registration
   * after a timeout instead. With real TCP the 'close' event would tell us
   * immediately - another small cost of the connection-oriented model.
   */
  const SESSION_TTL_MS = 30 * 60 * 1000;
  setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [cid, client] of clients) {
      if ((client.lastSeen ?? client.registeredAt) < cutoff) {
        clients.delete(cid);
        log.warn('udp', `expired stale session ${cid} @ ${client.key} (no traffic for ${SESSION_TTL_MS / 60000} min)`);
      }
    }
  }, 60_000).unref();

  return {
    proto: 'udp',
    listen() {
      return new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(port, host, () => {
          socket.removeListener('error', reject);
          log.ok('udp', `UDP backend bound to ${host}:${socket.address().port} (dgram.createSocket)`);
          resolve({ host, port: socket.address().port });
        });
      });
    },
    stats() {
      return {
        proto: 'udp',
        listening: Boolean(socket.address()),
        address: socket.address(),
        uptimeMs: Date.now() - stats.startedAt,
        // Unlike TCP there is no connection count: every message stands alone.
        connections: 0,
        clients: clients.size,
        framesIn: stats.framesIn,
        framesOut: stats.framesOut,
        datagramsDropped: stats.datagramsDropped,
        acksDropped: stats.acksDropped,
        reordered: stats.reordered,
        model: 'connectionless, best-effort, unordered datagrams',
        sessions: [...clients.values()].map((c) => ({
          cid: c.cid,
          label: c.label,
          address: c.addr,
          messages: c.messages,
          lastSeq: c.lastSeq,
          orderedOk: c.orderedOk,
        })),
      };
    },
    close() {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    },
  };
}

function truncate(text, max = 48) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}