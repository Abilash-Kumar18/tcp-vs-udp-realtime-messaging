import { HEADER_BYTES, LINK_BYTES, PURE_ACK_LINK_BYTES, round } from './protocol.js';

/**
 * Application payload of an application-level UDP ACK such as {"seq":42,"ok":1}.
 * Worth a couple of bytes because in UDP we have to build the ACK ourselves -
 * in TCP the kernel already sends bare, header-only ACK segments.
 */
export const ACK_PAYLOAD_BYTES = 14;

/**
 * Per-protocol metric accumulator.
 *
 * Everything the Experiment section reports is derived from this class, so the
 * numbers on the website come from the same code path as the live demo.
 */
export class ProtocolMetrics {
  constructor(proto) {
    this.proto = proto;
    this.headerBytes = HEADER_BYTES[proto];
    this.linkBytes = LINK_BYTES[proto];
    this.ackLinkBytes = PURE_ACK_LINK_BYTES[proto];
    this.reset();
  }

  reset() {
    this.handshakeMs = this.proto === 'udp' ? 0 : null; // UDP is connectionless: no handshake exists
    this.setupMs = null;
    this.connectedAt = null;
    this.sent = 0;
    this.acked = 0;
    this.lost = 0;
    this.inOrder = true;
    this.lastAckAt = null;
    this.rtts = [];
    this.dataBytes = 0; // application payload bytes
    this.ackBytes = 0; // bytes spent on acknowledgement traffic
    this.wireBytes = 0; // data + ack bytes actually put on the link
    this.injectedDrops = 0;
    this.reordered = 0;
    this.peakInFlight = 0;
    this.inFlight = 0;
  }

  markHandshake(ms) {
    this.handshakeMs = ms;
  }

  markSetup(ms) {
    this.setupMs = ms;
    this.connectedAt = Date.now();
  }

  /**
   * @param {object} info
   * @param {number} info.payloadBytes application payload size
   * @param {number} [info.rttMs]     round trip measured from a previous ping, if any
   */
  recordSend({ payloadBytes, rttMs = null }) {
    this.sent += 1;
    this.inFlight += 1;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    this.dataBytes += payloadBytes;
    this.wireBytes += payloadBytes + this.linkBytes;
    if (rttMs != null) this.rtts.push(rttMs);
  }

  recordAck() {
    this.acked += 1;
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.lastAckAt = Date.now();
    // A TCP ACK is header-only; a UDP "ACK" is a real datagram we pay for ourselves,
    // because UDP gives us no acknowledgement at all until we invent one.
    const cost = this.ackLinkBytes + (this.proto === 'tcp' ? 0 : ACK_PAYLOAD_BYTES);
    this.ackBytes += cost;
    this.wireBytes += cost;
  }

  recordLoss(count = 1) {
    this.lost += count;
    this.inFlight = Math.max(0, this.inFlight - count);
  }

  recordOutOfOrder() {
    this.inOrder = false;
  }

  recordInjectedDrop() {
    this.injectedDrops += 1;
  }

  recordReorder() {
    this.reordered += 1;
    this.inOrder = false;
  }

  percentile(p) {
    if (!this.rtts.length) return null;
    const sorted = [...this.rtts].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index];
  }

  get avgRttMs() {
    if (!this.rtts.length) return null;
    return this.rtts.reduce((a, b) => a + b, 0) / this.rtts.length;
  }

  snapshot(extra = {}) {
    const dataOverheadBytes = this.sent * this.headerBytes;
    const ackOverheadBytes = this.ackBytes;
    const totalOverheadBytes = dataOverheadBytes + ackOverheadBytes;

    return {
      proto: this.proto,
      // --- connection establishment -------------------------------------
      handshakeMs: round(this.handshakeMs ?? 0, 3),
      setupMs: round(this.setupMs ?? 0, 3),
      connected: this.connectedAt != null,
      // --- reliability ---------------------------------------------------
      sent: this.sent,
      acked: this.acked,
      lost: this.lost,
      deliveryRate: this.sent ? round((this.acked / this.sent) * 100, 2) : null,
      injectedDrops: this.injectedDrops,
      inOrder: this.inOrder,
      reordered: this.reordered,
      // --- latency -------------------------------------------------------
      avgRttMs: this.avgRttMs == null ? null : round(this.avgRttMs, 3),
      minRttMs: this.rtts.length ? round(Math.min(...this.rtts), 3) : null,
      maxRttMs: this.rtts.length ? round(Math.max(...this.rtts), 3) : null,
      p50RttMs: this.percentile(50) == null ? null : round(this.percentile(50), 3),
      p95RttMs: this.percentile(95) == null ? null : round(this.percentile(95), 3),
      peakInFlight: this.peakInFlight,
      // --- overhead ------------------------------------------------------
      headerBytes: this.headerBytes,
      linkHeaderBytes: this.linkBytes - this.headerBytes,
      dataBytes: this.dataBytes,
      ackBytes: this.ackBytes,
      wireBytes: this.wireBytes,
      dataOverheadBytes,
      ackOverheadBytes: ackOverheadBytes,
      totalOverheadBytes,
      overheadPercent: this.dataBytes ? round((totalOverheadBytes / this.dataBytes) * 100, 1) : null,
      overheadRatio: this.dataBytes ? round(totalOverheadBytes / this.dataBytes, 3) : null,
      lastAckAt: this.lastAckAt,
      ...extra,
    };
  }
}