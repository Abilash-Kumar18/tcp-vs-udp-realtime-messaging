import React, { useCallback, useEffect, useRef, useState } from 'react';

import { createConnection, pushChaos, resetChaos, fetchSource, fetchStats, gatewayLabel } from './gateway.js';
import { Nav, Section, Badge, Card, Note } from './lib/ui.jsx';

import Overview from './sections/Overview.jsx';
import Architecture from './sections/Architecture.jsx';
import LiveDemo from './sections/LiveDemo.jsx';
import Experiments from './sections/Experiments.jsx';
import CodeShowcase from './sections/CodeShowcase.jsx';
import ReportHelp from './sections/ReportHelp.jsx';

const NAV_LINKS = [
  { id: 'overview', label: 'Overview' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'demo', label: 'Live Demo' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'code', label: 'Code' },
  { id: 'report', label: 'Report Help' },
];

const MAX_LOG_ENTRIES = 300;

let entryId = 0;
const makeEntry = (level, text, time = clockShort()) => ({ id: ++entryId, level, text, time });

function clockShort() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

const EMPTY_METRICS = {
  sent: 0,
  acked: 0,
  lost: 0,
  deliveryRate: null,
  inOrder: true,
  avgRttMs: null,
  minRttMs: null,
  maxRttMs: null,
  p95RttMs: null,
  handshakeMs: 0,
  setupMs: null,
  dataBytes: 0,
  ackBytes: 0,
  wireBytes: 0,
  headerBytes: 0,
  totalOverheadBytes: 0,
  overheadPercent: null,
  overheadRatio: null,
  lastAckAt: null,
};

export default function App() {
  const connRef = useRef(null);

  const [gateway, setGateway] = useState({ state: 'connecting', ports: null });
  const [chaos, setChaos] = useState(null);
  const [backend, setBackend] = useState({ tcp: null, udp: null });
  const [sources, setSources] = useState({});

  const [panels, setPanels] = useState({
    tcp: { cid: 'tcp-panel', state: 'disconnected', setupMs: null, handshakeMs: null, info: null, logs: [], metrics: EMPTY_METRICS },
    udp: { cid: 'udp-panel', state: 'disconnected', setupMs: null, handshakeMs: null, info: null, logs: [], metrics: EMPTY_METRICS },
  });

  const [reports, setReports] = useState({ tcp: null, udp: null });
  const [running, setRunning] = useState({ tcp: false, udp: false });
  const [experimentProgress, setExperimentProgress] = useState({});

  /* ---------------- inbound gateway frames ---------------- */

  const patchPanel = useCallback((proto, patch) => {
    setPanels((prev) => {
      const next = { ...prev[proto], ...(typeof patch === 'function' ? patch(prev[proto]) : patch) };
      return { ...prev, [proto]: next };
    });
  }, []);

  const appendLog = useCallback((proto, level, text) => {
    setPanels((prev) => {
      const logs = [...prev[proto].logs, makeEntry(level, text)];
      return { ...prev, [proto]: { ...prev[proto], logs: logs.slice(-MAX_LOG_ENTRIES) } };
    });
  }, []);

  // Keep a ref of the latest panels so the socket handler can read them cheaply.
  const panelsRef = useRef(panels);
  panelsRef.current = panels;

  const handleFrame = useCallback(
    (msg) => {
      switch (msg.t) {
        case 'gateway-status':
          setGateway((g) => ({ ...g, state: msg.state }));
          break;

        case 'welcome':
          setGateway((g) => ({ ...g, ports: msg.config }));
          if (msg.chaos) setChaos(msg.chaos);
          break;

        case 'chaos':
          setChaos(msg.chaos);
          break;

        case 'log': {
          const proto = msg.proto;
          if (!proto || !panelsRef.current[proto]) return;
          // Experiment traffic is summarised in the Experiments section; a
          // 100-message burst would drown the interactive demo log.
          if (msg.exp || (msg.cid && msg.cid.startsWith('exp-'))) return;
          appendLog(proto, msg.level ?? 'info', msg.text ?? msg.kind);
          break;
        }

        case 'status':
          patchPanel(msg.proto, {
            state: msg.state,
            setupMs: msg.setupMs ?? null,
            handshakeMs: msg.handshakeMs ?? null,
            info: msg.info ?? null,
          });
          break;

        case 'metrics':
          if (msg.proto && panelsRef.current[msg.proto]) {
            patchPanel(msg.proto, { metrics: msg.metrics });
          }
          break;

        case 'backend':
          setBackend((b) => ({ ...b, [msg.proto]: msg.backend }));
          break;

        case 'experiment-progress':
          setExperimentProgress((p) => ({ ...p, [msg.proto]: msg }));
          break;

        case 'experiment-result':
          setReports((r) => ({ ...r, [msg.proto]: msg.report }));
          setRunning((r) => ({ ...r, [msg.proto]: false }));
          setExperimentProgress((p) => ({ ...p, [msg.proto]: null }));
          break;

        case 'experiment-busy':
          setRunning((r) => ({ ...r, [msg.proto]: false }));
          appendLog(msg.proto, 'warn', msg.text);
          break;

        case 'error':
          if (msg.proto && panelsRef.current[msg.proto]) appendLog(msg.proto, 'error', msg.text);
          break;

        default:
          break;
      }
    },
    [appendLog, patchPanel],
  );

  /* ---------------- the socket itself ----------------
     Created in an effect, never during render: opening a WebSocket is a side
     effect and would break any future server-side rendering. */
  useEffect(() => {
    const conn = createConnection();
    connRef.current = conn;
    const off = conn.subscribe(handleFrame);
    return () => {
      off();
      conn.close();
      connRef.current = null;
    };
  }, [handleFrame]);

  /* ---------------- initial data ---------------- */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stats = await fetchStats();
        if (cancelled) return;
        setChaos(stats.chaos);
        setBackend({ tcp: stats.tcp.backend, udp: stats.udp.backend });
      } catch {
        /* the gateway may still be starting */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const files = ['tcp-backend.js', 'udp-backend.js', 'tcp-link.js', 'udp-link.js'];
      const loaded = {};
      for (const file of files) {
        try {
          loaded[file] = await fetchSource(file);
        } catch {
          loaded[file] = null;
        }
      }
      if (!cancelled) setSources(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------- actions ---------------- */

  const emit = useCallback((payload) => {
    connRef.current?.send(payload);
  }, []);

  const connect = useCallback(
    (proto) => {
      emit({ t: 'connect', proto, cid: panelsRef.current[proto].cid, label: `${proto.toUpperCase()} panel` });
    },
    [emit],
  );

  const disconnect = useCallback(
    (proto) => {
      emit({ t: 'disconnect', proto, cid: panelsRef.current[proto].cid });
    },
    [emit],
  );

  const sendMessage = useCallback(
    (proto, text) => {
      if (!text.trim()) return;
      emit({ t: 'send', proto, cid: panelsRef.current[proto].cid, text });
    },
    [emit],
  );

  const clearLog = useCallback((proto) => {
    setPanels((prev) => ({ ...prev, [proto]: { ...prev[proto], logs: [] } }));
  }, []);

  const runExperiment = useCallback(
    (proto, n, payloadBytes) => {
      setRunning((r) => ({ ...r, [proto]: true }));
      setReports((r) => ({ ...r, [proto]: null }));
      setExperimentProgress((p) => ({ ...p, [proto]: { phase: 'connecting' } }));
      emit({ t: 'experiment', proto, n, payloadBytes });
    },
    [emit],
  );

  const applyChaos = useCallback((patch) => {
    setChaos((c) => ({ ...c, ...patch }));
    pushChaos(patch);
  }, []);

  const doResetChaos = useCallback(async () => {
    const { chaos: values } = await resetChaos();
    setChaos(values);
  }, []);

  return (
    <>
      <a href="#overview" className="sr-only">Skip to content</a>
      <Nav links={NAV_LINKS} />

      <header className="hero" id="top">
        <div className="shell hero-grid">
          <div>
            <div className="eyebrow">Computer Networks · Assignment</div>
            <h1>
              Real-time messaging over <span style={{ color: 'var(--tcp)' }}>TCP</span> and{' '}
              <span style={{ color: 'var(--udp)' }}>UDP</span>
            </h1>
            <p className="lede">
              Two identical chat panels, two genuinely different sockets. The blue server really does use{' '}
              <code>net.createServer()</code>; the orange one really does use <code>dgram.createSocket()</code>. Send the same
              messages, run the same experiment, and watch reliability, ordering and overhead fall out of the measurement instead
              of out of a textbook.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#demo">Try the live demo</a>
              <a className="btn" href="#experiments">Run the experiment</a>
              <a className="btn" href="#code">Read the code</a>
            </div>
          </div>

          <div className="hero-facts">
            <div className="fact">
              <b style={{ color: 'var(--tcp)' }}>40 B</b>
              <span>TCP header (20 B) + IPv4 header (20 B)</span>
            </div>
            <div className="fact">
              <b style={{ color: 'var(--udp)' }}>28 B</b>
              <span>UDP header (8 B) + IPv4 header (20 B)</span>
            </div>
            <div className="fact">
              <b>{gateway.ports?.tcpPort ?? 4001}</b>
              <span>TCP backend port</span>
            </div>
            <div className="fact">
              <b>{gateway.ports?.udpPort ?? 4002}</b>
              <span>UDP backend port</span>
            </div>
          </div>
        </div>
      </header>

      <div className="shell" style={{ paddingTop: '0.9rem' }}>
        <div className="btn-row" style={{ justifyContent: 'space-between' }}>
          <div className="btn-row">
            <Badge tone={gateway.state === 'online' ? 'ok' : 'bad'} dot={gateway.state === 'online' ? 'dot-live' : 'dot-bad'}>
              Gateway {gateway.state}
            </Badge>
            {gatewayLabel && (
              <Badge tone="mute" className="mono">
                <a
                  href={`https://${gatewayLabel}`}
                  title="This page is served separately from the gateway that owns the TCP and UDP sockets"
                  style={{ color: 'inherit' }}
                >
                  {gatewayLabel}
                </a>
              </Badge>
            )}
            {gateway.ports && (
              <Badge tone="mute" className="mono">
                http :{gateway.ports.httpPort} · tcp :{gateway.ports.tcpPort} · udp :{gateway.ports.udpPort}
              </Badge>
            )}
          </div>
          <Badge tone="mute">
            {backend.tcp ? `${backend.tcp.connections} TCP socket(s) · ` : ''}
            {backend.udp ? `${backend.udp.clients} UDP session(s)` : 'UDP session(s)'}
          </Badge>
        </div>
      </div>

      <Overview />
      <Architecture backend={backend} />
      <LiveDemo
        panels={panels}
        onConnect={connect}
        onDisconnect={disconnect}
        onSend={sendMessage}
        onClear={clearLog}
        onReset={(proto) => emit({ t: 'reset', proto })}
      />
      <Experiments
        chaos={chaos}
        onChaos={applyChaos}
        onResetChaos={doResetChaos}
        running={running}
        progress={experimentProgress}
        reports={reports}
        onRun={runExperiment}
      />
      <CodeShowcase sources={sources} />
      <ReportHelp reports={reports} />

      <footer className="footer">
        <div className="shell">
          <div className="grid grid-2">
            <div>
              <div className="brand" style={{ marginBottom: '0.5rem' }}>
                <span className="brand-mark" aria-hidden="true">
                  <i />
                  <i />
                </span>
                TCP vs UDP Lab
              </div>
              <p style={{ margin: 0 }}>
                Real sockets on real ports: <code>net.createServer()</code> and{' '}
                <code>dgram.createSocket('udp4')</code>, relayed to the browser over WebSocket.
              </p>
            </div>
            <div>
              <h4>Running it again</h4>
              <ul className="tight" style={{ marginBottom: 0 }}>
                <li>
                  <code>npm install</code> — once, from the project root
                </li>
                <li>
                  <code>npm run dev</code> — gateway on <code>:3000</code> + site on <code>:5173</code>
                </li>
                <li>
                  <code>npm run serve</code> — production build served from <code>:3000</code>
                </li>
                <li>
                  <code>node server/test/smoke.mjs</code> — 20 automated checks over both transports
                </li>
              </ul>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}