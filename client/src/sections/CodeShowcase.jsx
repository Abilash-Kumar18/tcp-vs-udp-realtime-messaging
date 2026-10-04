import React, { useState } from 'react';
import { Section, Card, Badge, Note } from '../lib/ui.jsx';
import { CodeBlock } from '../lib/highlight.jsx';

const FILES = [
  {
    id: 'tcp-backend.js',
    name: 'TCP server',
    badge: 'tcp',
    label: 'net',
    blurb: 'The real connection-oriented server. One socket per client, a Map of conversations, and zero reliability code.',
  },
  {
    id: 'udp-backend.js',
    name: 'UDP server',
    badge: 'udp',
    label: 'dgram',
    blurb: 'The real connectionless server. One socket for everyone, clients identified by source address, plus the loss injection.',
  },
  {
    id: 'tcp-link.js',
    name: 'TCP client',
    badge: 'tcp',
    label: 'net.Socket',
    blurb: 'The gateway side: measures the real handshake, frames the stream, records RTT and overhead.',
  },
  {
    id: 'udp-link.js',
    name: 'UDP client',
    badge: 'udp',
    label: 'dgram.Socket',
    blurb: 'The gateway side: binds a port, sends fire-and-forget datagrams and invents its own ACKs.',
  },
];

const CLIENT_LOGIC = `// The part students are usually asked to write: send, then handle the
// acknowledgement, and deal with the case where it never arrives.

const link = new (proto === 'tcp' ? TcpLink : UdpLink)({ host, port, chaos });

// ---- 1. Connect / register -------------------------------------------
// TCP: a real net.connect() completes the 3-way handshake before we may send.
// UDP: a single REGISTER datagram. There is no handshake and nothing to wait for.
const { setupMs, handshakeMs } = await link.connectSession(cid, 'my-client');
//   TCP -> { setupMs: 41.2, handshakeMs: 20.4 }   (handshake took a full RTT)
//   UDP -> { setupMs: 20.1, handshakeMs: 0.0 }    (nothing to measure)

// ---- 2. Send ---------------------------------------------------------
let seq = 0;
function send(text) {
  const ts = now();                      // stamp BEFORE the write, so the
  const seq = ++seq;                     // RTT includes the real socket time
  link.send(cid, text, { seq, ts });
  inFlight.set(seq, ts);                 // UDP: our only safety net
}

// ---- 3. Handle the acknowledgement ------------------------------------
link.on('event', (ev) => {
  if (ev.kind !== 'ack') return;
  const rtt = now() - sentAt.get(ev.seq);
  console.log('ACK', ev.seq, rtt.toFixed(2), 'ms');

  if (proto === 'udp' && !ev.extra.inOrder) {
    // Only UDP can do this: the network delivered #7 after #8.
    // A UDP app must reorder a buffer here. TCP makes this impossible.
    reorderingBuffer.set(ev.seq, ev);
  }
});

// ---- 4. Timeouts -----------------------------------------------------
// TCP: never needed — the kernel retransmits until it is acknowledged.
// UDP: required, because a lost datagram produces silence forever.
setTimeout(() => {
  for (const [seq, sentAt] of inFlight) {
    console.warn('no ACK for #%d after %d ms — resending', seq, TIMEOUT);
    send(payloads.get(seq));            // app-level retransmission
  }
}, 2000);`;

export default function CodeShowcase({ sources }) {
  const [active, setActive] = useState(FILES[0].id);
  const current = FILES.find((f) => f.id === active) ?? FILES[0];
  const code = sources[active];

  const lineCount = code ? code.split('\n').length : 0;

  return (
    <Section
      id="code"
      eyebrow="05 — Implementation"
      title="Code showcase"
      lead="These snippets are not copies pasted into a text box — they are served straight from the running server, so what you read is exactly what executed to produce the numbers above."
    >
      <div className="btn-row" style={{ marginBottom: '0.9rem' }}>
        <Badge tone="mute">server/src/</Badge>
        <a className="btn btn-sm" href={`/api/source/${current.id}?download=1`} download>
          ↓ Download {current.id}
        </a>
        <a className="btn btn-sm" href="https://github.com/topics/tcp-vs-udp" target="_blank" rel="noreferrer">
          Find more TCP vs UDP examples on GitHub ↗
        </a>
      </div>

      <Card>
        <div className="tabs" role="tablist" aria-label="Source files">
          {FILES.map((file) => (
            <button
              key={file.id}
              type="button"
              role="tab"
              aria-selected={active === file.id}
              className={`tab ${active === file.id ? 'active' : ''}`}
              onClick={() => setActive(file.id)}
            >
              {file.name}
              <span style={{ opacity: 0.6, marginLeft: '0.4rem', fontFamily: 'var(--mono)', fontSize: '0.72rem' }}>
                {file.id}
              </span>
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={active === 'client'}
            className={`tab ${active === 'client' ? 'active' : ''}`}
            onClick={() => setActive('client')}
          >
            Client logic
            <span style={{ opacity: 0.6, marginLeft: '0.4rem', fontFamily: 'var(--mono)', fontSize: '0.72rem' }}>
              send + ACK handling
            </span>
          </button>
        </div>

        <div className="card-title">
          <h4>
            {current.name}{' '}
            <Badge tone={current.badge}>{current.label}</Badge>
          </h4>
          {active !== 'client' && (
            <Badge tone="mute">
              {lineCount} lines · served from /api/source/{active}
            </Badge>
          )}
        </div>

        <p style={{ fontSize: '0.88rem', color: 'var(--ink-2)' }}>
          {active === 'client'
            ? 'The client half: connecting, timestamping sends, handling ACKs and detecting that an ACK never arrived.'
            : current.blurb}
        </p>

        {code ? (
          <CodeBlock code={code} />
        ) : active === 'client' ? (
          <CodeBlock code={CLIENT_LOGIC} />
        ) : (
          <Note>Loading <code>{active}</code> from the gateway…</Note>
        )}
      </Card>

      <div className="grid grid-2" style={{ marginTop: '1.1rem' }}>
        <Note tone="tcp">
          <strong>Framing matters.</strong> TCP gives you a byte stream, not messages: one <code>socket.write()</code> can
          arrive as several <code>'data'</code> events, and several writes can be merged into one. That is why{' '}
          <code>tcp-backend.js</code> buffers partial lines and only parses a frame once its terminating newline has
          arrived. UDP needs no such logic — one datagram is already one frame — but that is precisely the trade: TCP gives
          you a stream you must frame yourself, UDP gives you message boundaries you cannot exceed.
        </Note>
        <Note tone="udp">
          <strong>The ACK asymmetry.</strong> In <code>tcp-backend.js</code> the ACK is not application code at all — the
          kernel sends bare, header-only ACK segments automatically. In <code>udp-backend.js</code> the ACK is a second
          datagram the application must construct, which costs 28 bytes of header plus payload and, as the log demonstrates,
          can itself be lost. Reliable UDP means reimplementing TCP: sequence numbers, ACKs, timers and retransmission.
        </Note>
      </div>
    </Section>
  );
}