/**
 * Shared wire vocabulary between the gateway (client side) and the two backends.
 *
 * Both protocols reuse the same JSON envelope so the browser and the metrics
 * layer never have to care which transport carried a frame. The *transport*
 * underneath is genuinely different, and that difference is the whole point:
 *
 *   TCP -> byte stream, so we must add our own framing (newline-delimited JSON).
 *          A single socket.write() can be split across many 'data' events and
 *          several writes can be coalesced into one event. We cannot treat a
 *          'data' event as "a message".
 *   UDP -> message oriented, so ONE datagram == ONE frame. No framing needed,
 *          but we inherit datagram loss, duplication, reordering and the
 *          MTU limit instead.
 */

export const PROTOCOL_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Header / overhead accounting (the numbers used in the report)
 * ------------------------------------------------------------------ */

/** IPv4 header with no options. */
export const IP_HEADER_BYTES = 20;

/** Minimum TCP header (20 bytes: ports, sequence number, ack number, flags...). */
export const TCP_HEADER_BYTES = 20;

/** UDP header is famously small: source port + destination port + length + checksum. */
export const UDP_HEADER_BYTES = 8;

/** Ethernet II frame header, included so "bytes on the wire" is realistic. */
export const LINK_HEADER_BYTES = 14;

/**
 * Transport + network header cost per protocol.
 * This is the number usually quoted in textbooks (40 bytes for TCP, 28 for UDP).
 */
export const HEADER_BYTES = {
  tcp: IP_HEADER_BYTES + TCP_HEADER_BYTES, // 40
  udp: IP_HEADER_BYTES + UDP_HEADER_BYTES, // 28
};

/** Same, but including the Ethernet header, i.e. real bytes on the physical link. */
export const LINK_BYTES = {
  tcp: LINK_HEADER_BYTES + IP_HEADER_BYTES + TCP_HEADER_BYTES, // 54
  udp: LINK_HEADER_BYTES + IP_HEADER_BYTES + UDP_HEADER_BYTES, // 42
};

/**
 * A bare TCP segment that only carries an ACK has no payload at all, so the
 * whole frame is overhead. This is why TCP costs more per message even though
 * it never loses data.
 */
export const PURE_ACK_LINK_BYTES = {
  tcp: LINK_HEADER_BYTES + IP_HEADER_BYTES + TCP_HEADER_BYTES, // 54
  udp: LINK_HEADER_BYTES + IP_HEADER_BYTES + UDP_HEADER_BYTES, // 42
};

/** TCP advertises its own 40-byte header inside the first data segment. */
export const CONNECTION_METADATA_BYTES = {
  tcp: HEADER_BYTES.tcp + TCP_HEADER_BYTES, // MSS / window scale options
  udp: HEADER_BYTES.udp, // an 8 byte port pair is the closest analogue
};

/* ------------------------------------------------------------------ *
 * Framing helpers
 * ------------------------------------------------------------------ */

/** Serialise a frame. On TCP it becomes `json + "\n"`; on UDP the "\n" is dropped. */
export function encodeFrame(frame, { framed = true } = {}) {
  const json = JSON.stringify(frame);
  return framed ? `${json}\n` : json;
}

/**
 * Incremental newline decoder.
 *
 * Feeding this the raw chunks from a TCP socket is the practical lesson of
 * "TCP is a stream": we keep a leftover buffer and only emit a frame once its
 * terminating newline has arrived.
 */
export function createFrameDecoder(onFrame) {
  let buffer = '';
  return function feed(chunk) {
    buffer += chunk.toString('utf8');
    let index;
    // eslint-disable-next-line no-cond-assign
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      try {
        onFrame(JSON.parse(line));
      } catch {
        /* A partial or corrupt line is dropped; a stream protocol has no
           "atomicity" guarantee, which is exactly why we frame manually. */
      }
    }
  };
}

/* ------------------------------------------------------------------ *
 * Time helpers - sub-millisecond precision so the numbers are meaningful
 * on loopback, where a handshake costs a fraction of a millisecond.
 * ------------------------------------------------------------------ */

export function now() {
  return Math.round(performance.now() * 1000) / 1000;
}

export function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/* ------------------------------------------------------------------ *
 * Frame helpers - keep `t` short, every frame crosses a real socket
 * ------------------------------------------------------------------ */

export const Frame = {
  /* gateway -> backend */
  hello: (proto) => ({ v: PROTOCOL_VERSION, t: 'hello', role: 'gateway', proto }),
  register: (proto, cid, label) => ({ v: PROTOCOL_VERSION, t: 'register', proto, cid, label }),
  message: (proto, { cid, run, seq, ts, text }) => ({ v: PROTOCOL_VERSION, t: 'msg', proto, cid, run, seq, ts, text }),

  /* backend -> gateway */
  welcome: (proto, extra = {}) => ({ v: PROTOCOL_VERSION, t: 'welcome', proto, ...extra }),
  registered: (proto, extra = {}) => ({ v: PROTOCOL_VERSION, t: 'registered', proto, ...extra }),
  ack: (proto, extra = {}) => ({ v: PROTOCOL_VERSION, t: 'ack', proto, ...extra }),
  drop: (proto, extra = {}) => ({ v: PROTOCOL_VERSION, t: 'drop', proto, ...extra }),
  error: (proto, extra = {}) => ({ v: PROTOCOL_VERSION, t: 'error', proto, ...extra }),
};

/** Deterministic experiment payload so bytes/throughput are comparable. */
export function buildPayload(seq, size) {
  const head = `#${seq} `;
  return size <= head.length ? head.slice(0, size) : head + 'x'.repeat(size - head.length);
}