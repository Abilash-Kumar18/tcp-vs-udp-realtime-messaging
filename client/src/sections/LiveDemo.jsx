import React, { useCallback, useRef, useState } from 'react';
import { Section, Card, Badge, Note, LogBox, Stat, ms, num, pct, clockTime } from '../lib/ui.jsx';

const STATUS_TONE = {
  connected: 'ok',
  connecting: 'warn',
  disconnected: 'mute',
  error: 'bad',
};

function Panel({ proto, panel, onConnect, onDisconnect, onSend, onClear, onReset }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const isTcp = proto === 'tcp';
  const connected = panel.state === 'connected';
  const tone = isTcp ? 'tcp' : 'udp';

  const submit = useCallback(
    (event) => {
      event.preventDefault();
      if (!draft.trim() || !connected) return;
      onSend(proto, draft.trim());
      setDraft('');
      inputRef.current?.focus();
    },
    [draft, connected, onSend, proto],
  );

  const delta = panel.metrics.lost > 0 && panel.metrics.sent > 0;

  return (
    <Card tone={tone}>
      <div className="card-title">
        <h3 style={{ color: isTcp ? 'var(--tcp-ink)' : 'var(--udp-ink)' }}>
          {isTcp ? 'TCP Chat Demo' : 'UDP Chat Demo'}
        </h3>
        <div className="btn-row">
          <Badge tone={tone}>{isTcp ? 'net.Socket' : 'dgram.Socket'}</Badge>
          <Badge tone={STATUS_TONE[panel.state] ?? 'mute'} dot={connected ? 'dot-live' : 'dot-idle'}>
            {panel.state}
          </Badge>
        </div>
      </div>

      {/* status strip */}
      <div className="status-bar">
        <span>
          <strong>Handshake:</strong> <span className="mono">{ms(panel.handshakeMs, 3)}</span>
        </span>
        <span>
          <strong>Setup:</strong> <span className="mono">{ms(panel.setupMs, 3)}</span>
        </span>
        <span>
          <strong>Last ACK:</strong>{' '}
          <span className="mono">{panel.metrics.lastAckAt ? clockTime(panel.metrics.lastAckAt) : '—'}</span>
        </span>
        <span style={{ marginLeft: 'auto' }} className="btn-row">
          {connected ? (
            <button type="button" className="btn btn-sm" onClick={() => onDisconnect(proto)}>
              Disconnect
            </button>
          ) : (
            <button type="button" className={`btn btn-sm btn-${tone}`} onClick={() => onConnect(proto)}>
              {isTcp ? 'Connect (real handshake)' : 'Register (no handshake)'}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onClear(proto)} disabled={!panel.logs.length}>
            Clear log
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => onReset(proto)}
            title="Zero the counters for this protocol"
          >
            Reset stats
          </button>
        </span>
      </div>

      {/* live counters */}
      <div className="stats" style={{ marginBottom: '0.75rem' }}>
        <Stat label="Sent" value={num(panel.metrics.sent)} />
        <Stat label="ACKed" value={num(panel.metrics.acked)} tone={connected && panel.metrics.acked > 0 ? 'good' : ''} />
        <Stat
          label="Lost"
          value={num(panel.metrics.lost)}
          tone={delta ? 'bad' : ''}
          sub={delta ? 'no recovery' : isTcp ? 'kernel retries' : 'injected'}
        />
        <Stat label="Avg RTT" value={ms(panel.metrics.avgRttMs, 2)} />
        <Stat
          label="Order"
          value={panel.metrics.inOrder ? 'in order' : 'OUT OF ORDER'}
          tone={panel.metrics.inOrder ? 'good' : 'warn'}
        />
        <Stat label="Header" value={`${panel.metrics.headerBytes ?? (isTcp ? 40 : 28)} B`} sub="per message" />
      </div>

      {/* composer */}
      <form className="composer" onSubmit={submit}>
        <label className="sr-only" htmlFor={`${proto}-input`}>
          Message for the {isTcp ? 'TCP' : 'UDP'} server
        </label>
        <input
          id={`${proto}-input`}
          ref={inputRef}
          value={draft}
          disabled={!connected}
          placeholder={
            connected
              ? isTcp
                ? 'Type a message — the TCP stream will deliver it, in order, guaranteed'
                : 'Type a message — this datagram may vanish on the way'
              : isTcp
                ? 'Connect first — TCP refuses to send before the handshake completes'
                : 'Register first — the server needs your address to reply to'
          }
          onChange={(e) => setDraft(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" className={`btn btn-${tone}`} disabled={!connected || !draft.trim()}>
          Send
        </button>
      </form>

      <LogBox
        proto={isTcp ? 'TCP' : 'UDP'}
        entries={panel.logs}
        emptyText={
          connected
            ? 'Connected. Send a message to see the round trip.'
            : isTcp
              ? 'Not connected. A TCP client cannot send anything until net.connect() has completed its handshake.'
              : 'Not registered. A UDP client needs no handshake, but the server must know your address to reply.'
        }
        footLeft={`${panel.logs.length} entries`}
        footRight={panel.info ?? ''}
      />

      <div className="btn-row" style={{ marginTop: '0.6rem' }}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!connected}
          onClick={() => onSend(proto, `hello ${isTcp ? 'TCP' : 'UDP'} #${panel.metrics.sent + 1}`)}
        >
          Send sample
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!connected}
          title="Try to overflow a 1500-byte MTU link"
          onClick={() => onSend(proto, `oversized-${'x'.repeat(2000)}`)}
        >
          Send 2 KB (MTU test)
        </button>
        {!isTcp && (
          <button type="button" className="btn btn-sm" disabled={!connected} onClick={() => onSend(proto, 'one two three four five')}>
            Send 5 in a row
          </button>
        )}
      </div>
    </Card>
  );
}

/** Shows the last exchange as a protocol-level trace. */
function WireTrace({ panel, proto }) {
  const relevant = panel.logs.filter((e) => e.level === 'out' || e.level === 'in' || e.level === 'error' || e.level === 'warn');
  if (relevant.length === 0) return null;

  const isTcp = proto === 'tcp';
  const header = isTcp ? 40 : 28;
  const recent = relevant.slice(-6);
  const sent = panel.metrics.sent;
  const acked = panel.metrics.acked;
  const bytesOut = sent * header;
  const bytesAck = panel.metrics.ackBytes || 0;

  return (
    <Card tight>
      <div className="card-title">
        <h4>Wire accounting for this session</h4>
        <Badge tone={isTcp ? 'tcp' : 'udp'}>
          {header} B header × {sent} = {bytesOut} B
        </Badge>
      </div>
      <div className="table-wrap">
        <table>
          <tbody>
            <tr>
              <th scope="row">Application payload</th>
              <td className="metric">{num(panel.metrics.dataBytes)} B</td>
              <td>the actual chat text</td>
            </tr>
            <tr>
              <th scope="row">Protocol overhead</th>
              <td className="metric">
                {num(panel.metrics.totalOverheadBytes)} B
                {panel.metrics.overheadPercent != null && (
                  <span style={{ color: 'var(--ink-3)' }}> ({pct(panel.metrics.overheadPercent, 0)})</span>
                )}
              </td>
              <td>
                {sent} × {header} B headers + {num(bytesAck)} B of ACK traffic
              </td>
            </tr>
            <tr>
              <th scope="row">Total on the wire</th>
              <td className="metric">{num(panel.metrics.wireBytes)} B</td>
              <td>
                {acked}/{sent} delivered
                {panel.metrics.lost > 0 && <span style={{ color: 'var(--bad)' }}> · {panel.metrics.lost} lost forever</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="chips" style={{ marginTop: '0.6rem' }}>
        {recent.map((e, i) => (
          <span
            key={`${e.id}-${i}`}
            className="chip"
            style={
              e.level === 'error'
                ? { background: '#fdecec', borderColor: '#f6bcbc', color: '#8f1d1d' }
                : e.level === 'warn'
                  ? { background: '#fef3e2', borderColor: '#f8d9a8', color: '#7a4a05' }
                  : e.level === 'in'
                    ? { background: '#e7f7f0', borderColor: '#a7e3cb', color: '#05563f' }
                    : undefined
            }
          >
            {e.text}
          </span>
        ))}
      </div>
    </Card>
  );
}

export default function LiveDemo({ panels, onConnect, onDisconnect, onSend, onClear, onReset }) {
  const anyConnected = panels.tcp.state === 'connected' || panels.udp.state === 'connected';

  return (
    <Section
      id="demo"
      eyebrow="03 — Interact"
      title="Live demo"
      lead="Two identical clients, two different sockets. Connect both, send the same messages, and compare the log lines."
    >
      <div className="demo-grid">
        <Panel
          proto="tcp"
          panel={panels.tcp}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onSend={onSend}
          onClear={onClear}
          onReset={onReset}
        />
        <Panel
          proto="udp"
          panel={panels.udp}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onSend={onSend}
          onClear={onClear}
          onReset={onReset}
        />
      </div>

      <div className="grid grid-side" style={{ marginTop: '1.1rem' }}>
        <WireTrace panel={panels.tcp} proto="tcp" />
        <Card tight>
          <div className="card-title">
            <h4>What to look for</h4>
          </div>
          {anyConnected ? (
            <ul className="tight" style={{ margin: 0 }}>
              <li>
                <strong>Before connecting:</strong> the TCP input stays disabled. <code>socket.write()</code> on an
                unconnected socket throws — there is no "just send it and see".
              </li>
              <li>
                <strong>On connect:</strong> the TCP panel reports a real handshake time; the UDP panel always reports{' '}
                <code>0 ms</code> because no handshake exists.
              </li>
              <li>
                <strong>Red LOST lines</strong> in the UDP log are datagrams (or their ACKs) that the simulation destroyed.
                Nothing in the TCP log can ever look like this.
              </li>
              <li>
                <strong>MTU test:</strong> the 2 KB button makes the UDP backend reject the datagram with{' '}
                <code>MESSAGE_TOO_LARGE</code>. TCP has no such limit — it splits the stream into segments.
              </li>
              <li>
                <strong>Open a second browser tab</strong> to see the TCP backend serving several logical clients over one
                socket, each identified by its client id.
              </li>
            </ul>
          ) : (
            <Note>
              Connect a panel above and this becomes a live byte-accounting breakdown of the conversation, plus a short
              guide to what to watch for in the log.
            </Note>
          )}
        </Card>
      </div>
    </Section>
  );
}