/**
 * A tiny mutable knob bag shared by both backends.
 *
 * These are the "chaos" switches from the UI. They let a student *see* the
 * properties that normally only show up on a lossy, high-latency network:
 *
 *   udpDrop / udpAckDrop / udpReorder  -> only UDP (TCP is reliable by design)
 *   latencyMs                          -> applied to BOTH so comparisons stay fair
 *   tcpHandshakeRttMs                  -> only TCP (UDP has nothing to hand shake)
 */
export function createChaos(defaults) {
  const chaos = {
    udpDrop: defaults.udpDrop,
    udpAckDrop: defaults.udpAckDrop,
    udpReorder: defaults.udpReorder,
    latencyMs: defaults.latencyMs,
    tcpHandshakeRttMs: defaults.tcpHandshakeRttMs,
    ackTimeoutMs: defaults.ackTimeoutMs,
    exposeDrops: defaults.exposeDrops,
  };

  const LIMITS = {
    udpDrop: [0, 1],
    udpAckDrop: [0, 1],
    udpReorder: [0, 1],
    latencyMs: [0, 200],
    tcpHandshakeRttMs: [0, 500],
    ackTimeoutMs: [200, 15000],
  };

  return {
    values: chaos,
    defaults: { ...defaults },
    set(patch = {}) {
      for (const [key, value] of Object.entries(patch)) {
        if (!(key in chaos)) continue;
        if (typeof chaos[key] === 'boolean') chaos[key] = Boolean(value);
        else {
          const numeric = Number(value);
          if (!Number.isFinite(numeric)) continue;
          const [min, max] = LIMITS[key] || [-Infinity, Infinity];
          chaos[key] = Math.min(max, Math.max(min, numeric));
        }
      }
      return { ...chaos };
    },
    reset() {
      Object.assign(chaos, this.defaults);
      return { ...chaos };
    },
    /** @param {number} probability 0..1 */
    roll(probability) {
      return Math.random() < probability;
    },
  };
}