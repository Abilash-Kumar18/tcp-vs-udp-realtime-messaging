import { buildPayload, round } from './protocol.js';

/**
 * Burst experiment: send N messages as fast as the socket allows, then measure
 * setup cost, delivery rate, RTT distribution, ordering and overhead.
 *
 * The loop is deliberately synchronous - we do not wait for ACKs. That is the
 * whole point: it produces a burst that exposes buffering behaviour, and it
 * shows how many messages are still "in flight" when the first ACK comes back.
 *
 * Anything that has not been acknowledged by the time the ACK deadline expires
 * is counted as lost. For TCP that number should be 0 (the kernel retransmits);
 * for UDP it equals whatever we injected with the loss knobs.
 */
export function runExperiment(link, { cid, n = 100, payloadBytes = 32, ackTimeoutMs = 2500 }) {
  return new Promise((resolve) => {
    const run = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const previousHandshake = link.metrics.handshakeMs;
    const previousSetup = link.metrics.setupMs;
    link.metrics.reset();
    link.metrics.markHandshake(previousHandshake ?? 0);
    link.metrics.markSetup(previousSetup ?? 0);

    const ackedSeqs = [];
    const dropNotices = [];
    let finished = false;

    const onEvent = (ev) => {
      if (ev.run !== run) return;
      if (ev.kind === 'ack') ackedSeqs.push(ev.seq);
      if (ev.kind === 'drop') {
        dropNotices.push({ seq: ev.seq, phase: ev.extra?.phase ?? null, reason: ev.extra?.reason ?? null });
      }
      if (ackedSeqs.length >= n) finish();
    };
    link.on('event', onEvent);

    // --- the burst ----------------------------------------------------
    const burstStart = performance.now();
    for (let seq = 1; seq <= n; seq += 1) {
      link.send(cid, buildPayload(seq, payloadBytes), { run, payloadBytes });
    }
    const burstMs = performance.now() - burstStart;

    const timer = setTimeout(finish, ackTimeoutMs);

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      link.off('event', onEvent);

      const totalMs = performance.now() - burstStart;
      const acked = ackedSeqs.length;
      const lost = Math.max(0, n - acked);

      // Did sequence numbers come back in the order they were sent?
      let outOfOrder = 0;
      for (let i = 1; i < ackedSeqs.length; i += 1) {
        if (ackedSeqs[i] <= ackedSeqs[i - 1]) outOfOrder += 1;
      }

      // Any seq still outstanding when the deadline expired = presumed lost.
      const ackedSet = new Set(ackedSeqs);
      const lostSeqs = [];
      for (let seq = 1; seq <= n; seq += 1) if (!ackedSet.has(seq)) lostSeqs.push(seq);

      const m = link.metrics;
      const report = {
        proto: link.proto,
        run,
        cid,
        n,
        payloadBytes,
        // --- connection establishment ---
        handshakeMs: round(previousHandshake ?? 0, 3),
        setupMs: round(previousSetup ?? 0, 3),
        // --- timing ---
        burstMs: round(burstMs, 3),
        totalMs: round(totalMs, 3),
        waitMs: round(Math.max(0, totalMs - burstMs), 3),
        ackTimeoutMs,
        // --- reliability ---
        sent: n,
        acked,
        lost,
        deliveryRate: round((acked / n) * 100, 2),
        lostSeqs,
        dropNotices,
        // --- ordering ---
        inOrder: outOfOrder === 0,
        outOfOrder,
        // --- latency ---
        avgRttMs: m.avgRttMs == null ? null : round(m.avgRttMs, 3),
        minRttMs: m.rtts.length ? round(Math.min(...m.rtts), 3) : null,
        maxRttMs: m.rtts.length ? round(Math.max(...m.rtts), 3) : null,
        p50RttMs: m.percentile(50) == null ? null : round(m.percentile(50), 3),
        p95RttMs: m.percentile(95) == null ? null : round(m.percentile(95), 3),
        // --- throughput ---
        msgPerSec: round(n / (Math.max(totalMs, 0.001) / 1000), 1),
        payloadKbPerSec: round(((n * payloadBytes) / 1024) / (Math.max(totalMs, 0.001) / 1000), 2),
        wireKbPerSec: round((m.wireBytes / 1024) / (Math.max(totalMs, 0.001) / 1000), 2),
        // --- overhead ---
        overhead: {
          headerBytes: m.headerBytes,
          linkHeaderBytes: m.linkBytes - m.headerBytes,
          dataBytes: m.dataBytes,
          ackBytes: m.ackBytes,
          wireBytes: m.wireBytes,
          dataOverheadBytes: n * m.headerBytes,
          totalOverheadBytes: n * m.headerBytes + m.ackBytes,
          overheadPercent: m.dataBytes ? round(((n * m.headerBytes + m.ackBytes) / m.dataBytes) * 100, 1) : null,
          overheadRatio: m.dataBytes ? round((n * m.headerBytes + m.ackBytes) / m.dataBytes, 3) : null,
          ackCount: acked,
        },
      };

      // Anything still marked in-flight after the deadline is genuinely lost.
      link.metrics.recordLoss(lost);
      resolve(report);
    }
  });
}