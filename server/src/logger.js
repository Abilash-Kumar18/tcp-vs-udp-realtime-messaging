const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const traceEnabled = process.env.DEBUG_MESSAGES === '1';

function paint(color, text) {
  return useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

function stamp() {
  return new Date().toISOString().slice(11, 23);
}

function emit(stream, color, tag, message) {
  stream(`${paint('dim', stamp())} ${paint(color, tag)} ${message}`);
}

export const log = {
  info: (tag, message) => emit(console.log, 'cyan', tag, message),
  ok: (tag, message) => emit(console.log, 'green', tag, message),
  warn: (tag, message) => emit(console.warn, 'yellow', tag, message),
  error: (tag, message) => emit(console.error, 'red', tag, message),
  http: (tag, message) => emit(console.log, 'magenta', tag, message),

  /**
   * Per-message tracing. OFF by default.
   *
   * This matters more than it looks: writing a line per message to a redirected
   * stdout is a synchronous, blocking operation on Windows. With it enabled the
   * server's event loop stalls and the measured RTTs climb from ~1 ms to
   * 100+ ms, which would completely distort the experiment results.
   * Enable with DEBUG_MESSAGES=1 when you need a packet-level trace.
   */
  trace: (tag, message) => {
    if (traceEnabled) emit(console.log, 'dim', tag, message);
  },

  paint,
};