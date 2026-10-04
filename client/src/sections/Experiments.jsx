import React, { useState } from 'react';
import { Section, Card, Badge, Note, Stat, ms, num, pct } from '../lib/ui.jsx';

/* ------------------------------------------------------------------ *
 * Chaos panel — the knobs that make protocol behaviour visible
 * ------------------------------------------------------------------ */

const KNOBS = [
  {
    key: 'udpDrop',
    label: 'UDP message loss',
    hint: 'Probability the UDP backend silently discards an inbound datagram. TCP has no equivalent — it retransmits.',
    min: 0,
    max: 100,
    step: 5,
    scale: 100,
    format: (v) => `${v}%`,
    tone: 'udp',
  },
  {
    key: 'udpAckDrop',
    label: 'UDP ACK loss',
    hint: 'Probability the ACK datagram itself is discarded. This is the classic UDP trap: the acknowledgement can be lost too.',
    min: 0,
    max: 100,
    step: 5,
    scale: 100,
    format: (v) => `${v}%`,
    tone: 'udp',
  },
  {
    key: 'udpReorder',
    label: 'UDP reordering',
    hint: 'Probability a datagram is held back so a later one overtakes it. TCP cannot be reordered by the network.',
    min: 0,
    max: 100,
    step: 5,
    scale: 100,
    format: (v) => `${v}%`,
    tone: 'udp',
  },
  {
    key: 'latencyMs',
    label: 'Simulated one-way latency',
    hint: 'Extra delay applied by both backends so the comparison stays fair. Applied to every frame, both protocols.',
    min: 0,
    max: 120,
    step: 5,
    scale: 1,
    format: (v) => `${v} ms`,
    tone: 'shared',
  },
  {
    key: 'tcpHandshakeRttMs',
    label: 'Simulated TCP handshake RTT',
    hint: 'Added to the measured TCP connect time to imitate a handshake across a real network. UDP stays at 0 ms.',
    min: 0,
    max: 200,
    step: 5,
    scale: 1,
    format: (v) => `${v} ms`,
    tone: 'tcp',
  },
];

const PRESETS = [
  {
    label: 'Perfect network',
    hint: 'no loss, no latency',
    values: { udpDrop: 0, udpAckDrop: 0, udpReorder: 0, latencyMs: 0, tcpHandshakeRttMs: 0 },
  },
  {
    label: 'Realistic LAN',
    hint: '1% loss, 2 ms latency',
    values: { udpDrop: 0.01, udpAckDrop: 0.01, udpReorder: 0.02, latencyMs: 2, tcpHandshakeRttMs: 2 },
  },
  {
    label: 'Mobile / Wi-Fi',
    hint: '10% loss, 35 ms RTT',
    values: { udpDrop: 0.1, udpAckDrop: 0.1, udpReorder: 0.05, latencyMs: 18, tcpHandshakeRttMs: 18 },
  },
  {
    label: 'Bad Wi-Fi (default)',
    hint: '8% loss, high jitter',
    values: { udpDrop: 0.08, udpAckDrop: 0.08, udpReorder: 0.05, latencyMs: 0, tcpHandshakeRttMs: 0 },
  },
];

function ChaosPanel({ chaos, onChaos, onResetChaos }) {
  if (!chaos) return null;

  return (
    <Card tight>
      <div className="card-title">
        <h4>Network simulation</h4>
        <button type="button" className="btn btn-sm" onClick={onResetChaos}>
          Reset to server defaults
        </button>
      </div>

      <div className="btn-row" style={{ marginBottom: '0.9rem' }}>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="btn btn-sm"
            title={preset.hint}
            onClick={() => {
              for (const [k, v] of Object.entries(preset.values)) onChaos({ [k]: v });
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="knobs">
        {KNOBS.map((knob) => {
          const raw = chaos[knob.key] ?? 0;
          const value = Math.round(raw * knob.scale);
          return (
            <div key={knob.key} className={`knob-row ${knob.tone === 'tcp' ? 'tcp' : ''}`}>
              <label htmlFor={`knob-${knob.key}`}>
                {knob.label}
                {knob.tone !== 'shared' && (
                  <>
                    {' '}
                    <Badge tone={knob.tone}>{knob.tone === 'tcp' ? 'TCP only' : 'UDP only'}</Badge>
                  </>
                )}
              </label>
              <span className="knob-val">{knob.format(value)}</span>
              <input
                id={`knob-${knob.key}`}
                type="range"
                min={knob.min}
                max={knob.max}
                step={knob.step}
                value={value}
                onChange={(e) => onChaos({ [knob.key]: Number(e.target.value) / knob.scale })}
              />
              <span className="knob-hint">{knob.hint}</span>
            </div>
          );
        })}
      </div>

      <Note>
        <strong>These knobs are honest about what they are.</strong> Packet loss, ACK loss and reordering are{' '}
        <em>injected by the UDP backend on purpose</em> — a loopback network is effectively lossless, so without injection
        you could never observe the property the assignment asks you to examine. TCP cannot be made lossy this way: that is
        the entire point of it.
      </Note>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Experiment runner
 * ------------------------------------------------------------------ */

function RunCard({ proto, report, running, progress, onRun }) {
  const isTcp = proto === 'tcp';
  const [n, setN] = useState(100);
  const [payload, setPayload] = useState(32);

  const phaseText = progress
    ? progress.phase === 'connected'
      ? `connected in ${ms(progress.setupMs, 2)} · bursting ${n} messages…`
      : 'opening a fresh socket…'
    : '';

  return (
    <Card tone={isTcp ? 'tcp' : 'udp'}>
      <div className="card-title">
        <h4 style={{ color: isTcp ? 'var(--tcp-ink)' : 'var(--udp-ink)' }}>
          {isTcp ? 'TCP experiment' : 'UDP experiment'}
        </h4>
        <Badge tone={isTcp ? 'tcp' : 'udp'}>{isTcp ? 'net.Socket' : 'dgram.Socket'}</Badge>
      </div>

      <div className="btn-row" style={{ marginBottom: '0.7rem' }}>
        <label className="sr-only" htmlFor={`n-${proto}`}>
          Number of messages
        </label>
        <select
          id={`n-${proto}`}
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
          disabled={running}
          style={{
            font: 'inherit',
            fontSize: '0.85rem',
            padding: '0.45rem 0.6rem',
            borderRadius: 8,
            border: '1px solid var(--line-2)',
            background: '#fff',
          }}
        >
          {[25, 50, 100, 250, 500].map((v) => (
            <option key={v} value={v}>
              {v} messages
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor={`p-${proto}`}>
          Payload size
        </label>
        <select
          id={`p-${proto}`}
          value={payload}
          onChange={(e) => setPayload(Number(e.target.value))}
          disabled={running}
          style={{
            font: 'inherit',
            fontSize: '0.85rem',
            padding: '0.45rem 0.6rem',
            borderRadius: 8,
            border: '1px solid var(--line-2)',
            background: '#fff',
          }}
        >
          {[16, 32, 128, 512, 1024].map((v) => (
            <option key={v} value={v}>
              {v} B payload
            </option>
          ))}
        </select>

        <button
          type="button"
          className={`btn btn-${isTcp ? 'tcp' : 'udp'}`}
          onClick={() => onRun(proto, n, payload)}
          disabled={running}
        >
          {running ? (
            <>
              <span className="spinner" aria-hidden="true" /> Running…
            </>
          ) : (
            `Run experiment`
          )}
        </button>
      </div>

      {running && <p style={{ fontSize: '0.82rem', color: 'var(--ink-3)', marginBottom: 0 }}>{phaseText}</p>}

      {!running && report && (
        <div className="stats" style={{ marginTop: '0.6rem' }}>
          <Stat label="Handshake" value={ms(report.handshakeMs, 2)} sub={isTcp ? '3-way SYN' : 'none'} tone={isTcp ? 'warn' : 'good'} />
          <Stat label="Setup" value={ms(report.setupMs, 2)} sub="connect → ready" />
          <Stat label="Burst" value={ms(report.burstMs, 2)} sub={`${report.n} messages`} />
          <Stat label="Avg RTT" value={ms(report.avgRttMs, 2)} />
          <Stat label="p95 RTT" value={ms(report.p95RttMs, 2)} />
          <Stat label="Throughput" value={`${num(report.msgPerSec)}/s`} sub={`${report.payloadKbPerSec} KB/s payload`} />
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Side-by-side comparison
 * ------------------------------------------------------------------ */

const COMPARISON_ROWS = [
  {
    group: 'Connection establishment',
    rows: [
      { label: 'Handshake (connection setup)', get: (r) => ms(r.handshakeMs, 3), tcpBetter: false, note: 'TCP must complete SYN → SYN‑ACK → ACK before it can send application data. UDP has nothing to set up.' },
      { label: 'Total setup (ready to send)', get: (r) => ms(r.setupMs, 3), tcpBetter: false, note: 'Includes this app\'s own REGISTER round trip, which TCP pays on top of its handshake.' },
      { label: 'Round trips before 1st message', get: (r) => (r.proto === 'tcp' ? '2 RTT' : '1 RTT'), tcpBetter: false, note: 'The structural reason behind the setup numbers above.' },
    ],
  },
  {
    group: 'Reliability',
    rows: [
      { label: 'Messages sent', get: (r) => num(r.sent) },
      { label: 'Messages acknowledged', get: (r) => num(r.acked), tcpBetter: true },
      { label: 'Messages lost', get: (r) => num(r.lost), tcpBetter: true },
      { label: 'Delivery rate', get: (r) => pct(r.deliveryRate, 2), tcpBetter: true, highlight: true },
    ],
  },
  {
    group: 'Ordering',
    rows: [
      { label: 'Delivered in send order', get: (r) => (r.inOrder ? 'yes' : 'NO'), tcpBetter: true, highlight: true },
      { label: 'Out-of-order arrivals', get: (r) => num(r.outOfOrder), tcpBetter: true },
      { label: 'Sequence numbers needed in app?', get: () => 'no / yes', tcpBetter: true, note: 'TCP reassembles order in the kernel. A UDP app must number its own messages to detect gaps and reordering.' },
    ],
  },
  {
    group: 'Latency',
    rows: [
      { label: 'Average RTT', get: (r) => ms(r.avgRttMs, 3) },
      { label: 'Min / max RTT', get: (r) => `${ms(r.minRttMs, 2)} / ${ms(r.maxRttMs, 2)}` },
      { label: 'p50 / p95 RTT', get: (r) => `${ms(r.p50RttMs, 2)} / ${ms(r.p95RttMs, 2)}` },
      { label: 'Jitter (max − min)', get: (r) => ms(r.maxRttMs != null && r.minRttMs != null ? r.maxRttMs - r.minRttMs : null, 2) },
    ],
  },
  {
    group: 'Communication overhead',
    rows: [
      { label: 'Header per message', get: (r) => `${r.overhead.headerBytes} B`, tcpBetter: false, highlight: true, note: '20 B TCP + 20 B IPv4 = 40 B, versus 8 B UDP + 20 B IPv4 = 28 B.' },
      { label: 'Payload bytes', get: (r) => `${num(r.overhead.dataBytes)} B` },
      { label: 'Header overhead total', get: (r) => `${num(r.overhead.dataOverheadBytes)} B` },
      { label: 'ACK traffic', get: (r) => `${num(r.overhead.ackBytes)} B`, tcpBetter: false, note: 'TCP ACKs are automatic but still occupy the link. UDP ACKs are extra datagrams the app pays for.' },
      { label: 'Total overhead / payload', get: (r) => (r.overhead.overheadRatio != null ? `${r.overhead.overheadRatio.toFixed(2)}×` : '—'), tcpBetter: false, highlight: true, note: 'With small payloads, protocol overhead can dwarf the data itself.' },
      { label: 'Bytes on the wire', get: (r) => `${num(r.overhead.wireBytes)} B` },
    ],
  },
];

function ComparisonTable({ reports }) {
  const { tcp, udp } = reports;
  const ready = Boolean(tcp && udp);

  return (
    <Card>
      <div className="card-title">
        <h3>TCP vs UDP — measured side by side</h3>
        {ready ? (
          <div className="btn-row">
            <Badge tone="mute">n={num(tcp.n)} @ {tcp.payloadBytes} B</Badge>
            <Badge tone="mute">n={num(udp.n)} @ {udp.payloadBytes} B</Badge>
          </div>
        ) : (
          <Badge tone="warn">run both experiments to populate</Badge>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col" className="tcp-col">
                TCP
              </th>
              <th scope="col" className="udp-col">
                UDP
              </th>
              <th scope="col">What it tells you</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((group) => (
              <React.Fragment key={group.group}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={4}
                    style={{
                      background: '#f1f5f9',
                      fontSize: '0.72rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      color: 'var(--ink-3)',
                      fontWeight: 750,
                    }}
                  >
                    {group.group}
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" style={{ fontWeight: 650, minWidth: '13rem' }}>
                      {row.label}
                    </th>
                    <td className="metric tcp-col">{ready ? row.get(tcp) : '—'}</td>
                    <td className="metric udp-col">{ready ? row.get(udp) : '—'}</td>
                    <td style={{ color: 'var(--ink-2)', fontSize: '0.83rem', minWidth: '16rem' }}>{row.note ?? ''}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Visual delivery bar — the single clearest picture of reliability. */
function DeliveryBars({ reports }) {
  const { tcp, udp } = reports;
  if (!tcp && !udp) return null;

  return (
    <div className="grid grid-2">
      {[
        { proto: 'tcp', label: 'TCP delivery', report: tcp, tone: 'tcp' },
        { proto: 'udp', label: 'UDP delivery', report: udp, tone: 'udp' },
      ].map(({ proto, label, report, tone }) => (
        <Card key={proto} tone={tone} tight>
          <div className="card-title">
            <h4>{label}</h4>
            <Badge tone={report ? (report.lost === 0 ? 'ok' : 'bad') : 'mute'}>
              {report ? `${pct(report.deliveryRate, 1)} delivered` : 'not run'}
            </Badge>
          </div>
          {report ? (
            <>
              <div className="btn-row" style={{ marginBottom: '0.5rem' }}>
                <span className="bar">
                  <i className={tone} style={{ width: `${Math.min(100, report.deliveryRate)}%` }} />
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '0.82rem', fontWeight: 700 }}>
                  {num(report.acked)}/{num(report.sent)}
                </span>
              </div>
              <div className="chips">
                <span className="chip">handshake {ms(report.handshakeMs, 2)}</span>
                <span className="chip">avg RTT {ms(report.avgRttMs, 2)}</span>
                <span className="chip">{report.inOrder ? 'in order' : 'OUT OF ORDER'}</span>
                <span className="chip">
                  overhead {report.overhead.overheadRatio != null ? `${report.overhead.overheadRatio.toFixed(2)}×` : '—'}
                </span>
                {report.lost > 0 && <span className="chip" style={{ background: '#fdecec', borderColor: '#f6bcbc', color: '#8f1d1d' }}>{num(report.lost)} lost forever</span>}
              </div>
            </>
          ) : (
            <p style={{ fontSize: '0.85rem', color: 'var(--ink-3)', margin: 0 }}>
              Run the {proto.toUpperCase()} experiment above to populate this bar.
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}

function LostDetail({ reports }) {
  const rows = ['tcp', 'udp']
    .map((proto) => ({ proto, report: reports[proto] }))
    .filter((r) => r.report && r.report.lost > 0);

  if (rows.length === 0) return null;

  return (
    <Card tight>
      <div className="card-title">
        <h4>Which sequence numbers never came back?</h4>
        <Badge tone="warn">
          {rows.reduce((sum, r) => sum + r.report.lost, 0)} messages unrecoverable
        </Badge>
      </div>
      <p style={{ fontSize: '0.86rem', color: 'var(--ink-2)' }}>
        UDP gives the application no way to recover these. A real UDP client would need to detect the gap by sequence
        number, wait a timeout, and resend — re-implementing what TCP's kernel does automatically.
      </p>
      <div className="chips">
        {rows.map(({ proto, report }) => (
          <React.Fragment key={proto}>
            <Badge tone={proto === 'tcp' ? 'tcp' : 'udp'}>{proto.toUpperCase()}</Badge>
            {report.lostSeqs.slice(0, 40).map((seq) => (
              <span key={`${proto}-${seq}`} className="chip">
                #{seq}
              </span>
            ))}
            {report.lostSeqs.length > 40 && <span className="chip">… +{report.lostSeqs.length - 40} more</span>}
          </React.Fragment>
        ))}
      </div>
    </Card>
  );
}

export default function Experiments({ chaos, onChaos, onResetChaos, running, progress, reports, onRun }) {
  return (
    <Section
      id="experiments"
      eyebrow="04 — Measure"
      title="Experiment & metrics"
      lead="Send a burst of messages as fast as the socket allows and measure what comes back. Each run opens a fresh socket, so the TCP handshake is timed from scratch every time."
    >
      <div className="grid grid-2" style={{ marginBottom: '1.1rem' }}>
        <RunCard proto="tcp" report={reports.tcp} running={running.tcp} progress={progress.tcp} onRun={onRun} />
        <RunCard proto="udp" report={reports.udp} running={running.udp} progress={progress.udp} onRun={onRun} />
      </div>

      <div className="grid grid-side" style={{ marginBottom: '1.1rem' }}>
        <Card>
          <div className="card-title">
            <h3>Side-by-side results</h3>
            <Badge tone="mute">RTT measured at the socket</Badge>
          </div>
          {reports.tcp || reports.udp ? (
            <ComparisonTable reports={reports} />
          ) : (
            <Note>
              Nothing measured yet. Press <strong>Run experiment</strong> on both cards above — ideally{' '}
              <strong>first on TCP</strong> so you can see a 100% delivery rate before any UDP loss is introduced.
            </Note>
          )}
        </Card>

        <div style={{ display: 'grid', gap: '1rem', alignContent: 'start' }}>
          <ChaosPanel chaos={chaos} onChaos={onChaos} onResetChaos={onResetChaos} />
        </div>
      </div>

      <div style={{ display: 'grid', gap: '1rem' }}>
        <DeliveryBars reports={reports} />
        <LostDetail reports={reports} />

        <Card tight>
          <div className="card-title">
            <h4>How to interpret the results</h4>
          </div>
          <ul className="reasons">
            <li>
              <strong>Setup time answers "what does connection establishment cost?"</strong> TCP's handshake column is the
              3-way handshake: at least one round trip before a single byte of chat can be sent, plus one more for this
              app's registration. UDP's is structurally <code>0 ms</code>. The gap widens as the network gets slower —
              move the latency slider up and run both again.
            </li>
            <li>
              <strong>Delivery rate answers "what does reliability cost?"</strong> With UDP set to 0% loss, delivery is
              100% and the two protocols look similar. Raise the loss slider and TCP stays at 100% while UDP falls off —
              because the TCP backend's data is retransmitted by the kernel until the receiver confirms it, whereas a lost
              UDP datagram is simply gone.
            </li>
            <li>
              <strong>Ordering answers "can I trust the sequence?"</strong> TCP always reports <code>in order</code>,
              which is why a byte-stream reader can assume message <em>n+1</em> never overtakes message <em>n</em>. UDP
              reports out-of-order arrivals whenever the reordering knob is above zero, so any UDP application that cares
              about ordering must carry its own sequence numbers and buffer.
            </li>
            <li>
              <strong>Overhead ratio answers "what does reliability cost in bytes?"</strong> Each message carries 40 B of
              TCP header versus 28 B of UDP header — 12 bytes more. At a 32-byte payload that alone is a 37% overhead
              increase before counting ACKs. On a high-bandwidth path this is why UDP-based protocols such as QUIC, or
              custom UDP used for video and games, are so common: they avoid TCP's byte and latency costs by rebuilding
              only the reliability they actually need.
            </li>
          </ul>
        </Card>
      </div>
    </Section>
  );
}