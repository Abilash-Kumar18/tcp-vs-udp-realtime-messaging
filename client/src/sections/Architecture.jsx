import React from 'react';
import { Section, Badge, Card, Note } from '../lib/ui.jsx';

/**
 * Architecture diagram.
 *
 * The honest topology is a two-hop path:
 *
 *   Browser --WebSocket--> Gateway --TCP socket--> TCP backend (:4001)
 *                               \--UDP socket----> UDP backend (:4002)
 *
 * The browser cannot open raw TCP/UDP sockets, so the first hop is necessarily
 * WebSocket (which is itself TCP). Everything worth measuring happens on the
 * second hop, which uses real `net` and real `dgram` sockets.
 */
function Diagram() {
  return (
    <div className="diagram">
      <svg viewBox="0 0 900 430" role="img" aria-label="Diagram of the browser, gateway, TCP backend and UDP backend">
        <defs>
          <marker id="arrow-t" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#2f6bff" />
          </marker>
          <marker id="arrow-u" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#f97316" />
          </marker>
          <marker id="arrow-g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>

        {/* ---------------- browser ---------------- */}
        <rect className="dg-box" x="24" y="150" width="168" height="130" rx="12" />
        <text className="dg-title" x="108" y="182" textAnchor="middle">
          Browser
        </text>
        <text className="dg-sub" x="108" y="204" textAnchor="middle">
          React SPA
        </text>
        <text className="dg-note" x="108" y="228" textAnchor="middle">
          2 demo panels
        </text>
        <text className="dg-note" x="108" y="248" textAnchor="middle">
          experiment runner
        </text>
        <text className="dg-note" x="108" y="268" textAnchor="middle">
          (no raw sockets)</text>

        {/* browser -> gateway */}
        <line x1="192" y1="200" x2="308" y2="200" stroke="#94a3b8" strokeWidth="2" markerEnd="url(#arrow-g)" />
        <line x1="308" y1="224" x2="192" y2="224" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="4 4" markerEnd="url(#arrow-g)" />
        <text className="dg-label" x="250" y="192" textAnchor="middle" fill="#64748b">
          WebSocket
        </text>
        <text className="dg-note" x="250" y="242" textAnchor="middle">
          reliable (it is TCP)
        </text>

        {/* ---------------- gateway ---------------- */}
        <rect className="dg-box" x="308" y="96" width="230" height="240" rx="12" fill="#f8fafc" />
        <text className="dg-title" x="423" y="126" textAnchor="middle">
          Gateway (Node :3000)
        </text>
        <text className="dg-sub" x="423" y="146" textAnchor="middle">
          express + ws
        </text>

        <rect className="dg-box dg-tcp" x="330" y="164" width="186" height="66" rx="9" />
        <text className="dg-title" x="423" y="188" textAnchor="middle" fontSize="11.5">
          TcpLink
        </text>
        <text className="dg-sub" x="423" y="206" textAnchor="middle">
          net.Socket (client)
        </text>
        <text className="dg-note" x="423" y="222" textAnchor="middle">
          connect() → handshake
        </text>

        <rect className="dg-box dg-udp" x="330" y="244" width="186" height="66" rx="9" />
        <text className="dg-title" x="423" y="268" textAnchor="middle" fontSize="11.5">
          UdpLink
        </text>
        <text className="dg-sub" x="423" y="286" textAnchor="middle">
          dgram.Socket
        </text>
        <text className="dg-note" x="423" y="302" textAnchor="middle">
          bind() → nothing else
        </text>

        {/* gateway -> tcp backend */}
        <path
          d="M 516 190 C 600 190, 600 120, 676 120"
          fill="none"
          stroke="#2f6bff"
          strokeWidth="2.5"
          markerEnd="url(#arrow-t)"
        />
        <path
          d="M 676 168 C 600 168, 600 196, 516 196"
          fill="none"
          stroke="#93b4ff"
          strokeWidth="2"
          markerEnd="url(#arrow-t)"
        />
        <text className="dg-label dg-t" x="600" y="108" textAnchor="middle">
          TCP stream
        </text>
        <text className="dg-note" x="600" y="188" textAnchor="middle">
          40 B header · ACK 54 B
        </text>
        <text className="dg-note" x="600" y="204" textAnchor="middle">
          reliable + ordered
        </text>

        {/* gateway -> udp backend */}
        <path
          d="M 516 276 C 600 276, 600 340, 676 340"
          fill="none"
          stroke="#f97316"
          strokeWidth="2.5"
          strokeDasharray="7 4"
          markerEnd="url(#arrow-u)"
        />
        <path
          d="M 676 388 C 600 388, 600 320, 516 320"
          fill="none"
          stroke="#fdba74"
          strokeWidth="2"
          strokeDasharray="7 4"
          markerEnd="url(#arrow-u)"
        />
        <text className="dg-label dg-u" x="600" y="366" textAnchor="middle">
          UDP datagrams
        </text>
        <text className="dg-note" x="600" y="380" textAnchor="middle">
          28 B header · ACK 42+ B
        </text>
        <text className="dg-note" x="600" y="396" textAnchor="middle">
          best effort · unordered
        </text>

        {/* ---------------- backends ---------------- */}
        <rect className="dg-box dg-tcp" x="676" y="86" width="200" height="82" rx="11" />
        <text className="dg-title" x="776" y="112" textAnchor="middle">
          TCP backend :4001
        </text>
        <text className="dg-sub" x="776" y="132" textAnchor="middle">
          net.createServer()
        </text>
        <text className="dg-note" x="776" y="152" textAnchor="middle">
          1 socket per client · Map
        </text>

        <rect className="dg-box dg-udp" x="676" y="306" width="200" height="82" rx="11" />
        <text className="dg-title" x="776" y="332" textAnchor="middle">
          UDP backend :4002
        </text>
        <text className="dg-sub" x="776" y="352" textAnchor="middle">
          dgram.createSocket('udp4')
        </text>
        <text className="dg-note" x="776" y="372" textAnchor="middle">
          1 socket total · Map by cid
        </text>

        {/* chaos injector */}
        <rect className="dg-box" x="24" y="306" width="168" height="86" rx="11" fill="#fffbeb" stroke="#f8d9a8" />
        <text className="dg-title" x="108" y="334" textAnchor="middle" fontSize="12">
          Chaos knobs
        </text>
        <text className="dg-note" x="108" y="356" textAnchor="middle">
          UDP drop · ack drop
        </text>
        <text className="dg-note" x="108" y="374" textAnchor="middle">
          reorder · latency
        </text>
        <path d="M 192 349 C 240 349, 250 300, 308 292" fill="none" stroke="#f8d9a8" strokeWidth="2" strokeDasharray="3 3" />
        <path d="M 192 349 C 250 349, 620 360, 676 366" fill="none" stroke="#f8d9a8" strokeWidth="1.5" strokeDasharray="3 3" />
      </svg>
    </div>
  );
}

export default function Architecture({ backend }) {
  return (
    <Section
      id="architecture"
      eyebrow="02 — Design"
      title="Architecture"
      lead="Three Node processes in one, so the transport under test is a real socket on a real port rather than a library call. The gateway is the client of both backends; the browser is a client of the gateway."
    >
      <Diagram />

      <div className="grid grid-2" style={{ marginTop: '1.4rem' }}>
        <Card tone="tcp">
          <div className="card-title">
            <h4>How the TCP server handles many clients</h4>
            <Badge tone="tcp">{backend?.tcp?.connections ?? 0} open</Badge>
          </div>
          <ol className="reasons">
            <li>
              <code>net.createServer()</code> accepts one TCP connection and hands it to the callback. Each accepted
              socket becomes a long-lived, stateful conversation, so the server keeps a <code>Map</code> of sockets and can
              serve any number of clients at once.
            </li>
            <li>
              Because a single socket only ever carries <em>one</em> conversation, every frame needs an application-level
              client id (<code>cid</code>) so the server knows who a message belongs to. UDP needs the same id, but for a
              completely different reason — see below.
            </li>
            <li>
              Reliability needs <em>no code at all</em>. The kernel retransmits lost segments, reorders nothing and
              deduplicates for free, so this server never implements a timer, a retry or a sequence check.
            </li>
            <li>
              The catch is shutdown: when a client vanishes, TCP tells the server via a <code>close</code> event, so the
              server can clean up precisely. That event simply does not exist in UDP.
            </li>
          </ol>
        </Card>

        <Card tone="udp">
          <div className="card-title">
            <h4>How the UDP server handles many clients</h4>
            <Badge tone="udp">{backend?.udp?.clients ?? 0} registered</Badge>
          </div>
          <ol className="reasons">
            <li>
              <code>dgram.createSocket('udp4')</code> creates <strong>one</strong> socket for the whole server. There is no
              <code> accept()</code>, no connection callback and no per-client socket — every datagram from every client
              arrives on the same socket.
            </li>
            <li>
              The server therefore identifies a client by its <strong>source address and port</strong> returned with each
              datagram (<code>rinfo</code>), plus the <code>cid</code> inside the payload. "Registration" is just an entry
              in a <code>Map</code>; nothing was negotiated.
            </li>
            <li>
              Every message is independent. If the socket stops hearing from an address the server cannot tell whether the
              client is idle or gone, so stale entries have to be expired on a timer.
            </li>
            <li>
              To answer at all, the application must build ACKs itself — and those ACKs can be lost too. That is the whole
              reason UDP feels unreliable rather than merely "fast".
            </li>
          </ol>
        </Card>
      </div>

      <Note>
        <strong>Why is the first hop a WebSocket?</strong> Browsers are not allowed to open raw TCP or UDP sockets. The
        WebSocket hop is itself a reliable TCP stream, so the browser can never demonstrate UDP-style loss — which is
        exactly why all loss, ordering and overhead measurements on this page are taken on the{' '}
        <strong>gateway → backend</strong> hop, where real <code>net</code> and <code>dgram</code> sockets are in play.
      </Note>
    </Section>
  );
}