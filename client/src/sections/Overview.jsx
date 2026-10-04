import React from 'react';
import { Section, Badge, Card, Note } from '../lib/ui.jsx';

const COMPARISON = [
  {
    aspect: 'Connection model',
    tcp: 'Connection-oriented. A 3-way handshake (SYN → SYN‑ACK → ACK) happens before any data. State lives on both ends.',
    udp: 'Connectionless. No handshake, no setup. The first datagram is simply handed to the IP layer.',
  },
  {
    aspect: 'Reliability',
    tcp: 'Guaranteed. Lost segments are retransmitted by the kernel until the receiver acknowledges them.',
    udp: 'Best effort. A datagram can vanish with no notification. The app must detect and repair this itself.',
  },
  {
    aspect: 'Ordering',
    tcp: 'Strictly in order. Sequence + acknowledgement numbers reassemble the byte stream in send order.',
    udp: 'Unordered. Datagrams travel independently and can arrive out of sequence or duplicated.',
  },
  {
    aspect: 'Header size',
    tcp: '20 B TCP + 20 B IPv4 = 40 B of overhead per segment (plus options).',
    udp: '8 B UDP + 20 B IPv4 = 28 B of overhead per datagram. 12 bytes lighter than TCP.',
  },
  {
    aspect: 'Acknowledgement cost',
    tcp: 'Free and automatic — a bare 40 B ACK segment rides back for every segment received.',
    udp: 'Extra. There is no ACK at all until the application builds one, costing a whole extra datagram.',
  },
  {
    aspect: 'Flow / congestion control',
    tcp: 'Yes. Sliding window plus congestion control (slow start, retransmit on loss) adapts to the network.',
    udp: 'None. A fast sender can overwhelm the receiver or the router queue and make things worse.',
  },
  {
    aspect: 'Boundaries',
    tcp: 'A byte stream. Message boundaries do not exist; you must frame the data yourself.',
    udp: 'Message oriented. One datagram is one message, but you are limited to the path MTU (~1472 B payload).',
  },
  {
    aspect: 'Typical use',
    tcp: 'HTTP/HTTPS, SSH, email, databases, file transfer — anything where losing or reordering data is unacceptable.',
    udp: 'DNS, DHCP, VoIP, video/game streaming, QUIC/HTTP3, telemetry — anything where latency and fresh data beat completeness.',
  },
];

export default function Overview() {
  return (
    <Section
      id="overview"
      eyebrow="01 — Concept"
      title="Two transports, one application"
      lead="Both panels below run the same chat application. Only the socket underneath changes. Everything you are about to see — the extra round trip before the first message, the messages that never come back, the bytes spent on headers — is a property of the transport, not of the code."
    >
      <div className="grid grid-2" style={{ marginBottom: '1.4rem' }}>
        <Card tone="tcp">
          <div className="card-title">
            <h3 style={{ color: 'var(--tcp-ink)' }}>TCP — Transmission Control Protocol</h3>
            <Badge tone="tcp">RFC 9293</Badge>
          </div>
          <p>
            Think of TCP as a phone call. You dial, the other side answers, and only then can you talk. Once the call is
            up, the network and the two operating systems between you guarantee that every word arrives exactly once and in
            the order you said it — retransmitting behind the scenes when packets go missing, and slowing you down when the
            link gets congested.
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>Price:</strong> that guarantee costs time before the first message (the handshake), bytes on every
            message (a 20-byte header instead of 8), and bytes again on every acknowledgement.
          </p>
        </Card>

        <Card tone="udp">
          <div className="card-title">
            <h3 style={{ color: 'var(--udp-ink)' }}>UDP — User Datagram Protocol</h3>
            <Badge tone="udp">RFC 768</Badge>
          </div>
          <p>
            Think of UDP as shouting across a field. You shout, an echo may come back, and it may be garbled, out of order,
            or swallowed by the wind. Nothing is set up in advance, and nobody guarantees you will ever hear an answer.
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>Price:</strong> nothing is guaranteed and nothing is set up — which is exactly why real-time applications
            (voice, video, games, DNS) accept it. A late message is often worse than no message at all.
          </p>
        </Card>
      </div>

      <div className="table-wrap">
        <table>
          <caption className="sr-only">TCP and UDP compared across eight properties</caption>
          <thead>
            <tr>
              <th scope="col">Property</th>
              <th scope="col" className="tcp-col">
                TCP <Badge tone="tcp">net</Badge>
              </th>
              <th scope="col" className="udp-col">
                UDP <Badge tone="udp">dgram</Badge>
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.aspect}>
                <th scope="row" style={{ fontWeight: 650 }}>
                  {row.aspect}
                </th>
                <td className="tcp-col">{row.tcp}</td>
                <td className="udp-col">{row.udp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-2" style={{ marginTop: '1.4rem' }}>
        <Note tone="tcp">
          <strong>Where you meet TCP every day:</strong> every web page load, your bank login, an <code>npm install</code>,
          a remote shell over SSH. When a byte goes missing, TCP hides it from the application completely.
        </Note>
        <Note tone="udp">
          <strong>Where you meet UDP every day:</strong> the DNS lookup that turns a hostname into an IP, the video call
          that stays smooth instead of stalling, the ping that measures your latency.
        </Note>
      </div>

      <Card className="card" >
        <div className="card-title">
          <h4>How to read the numbers on this site</h4>
        </div>
        <ul className="tight">
          <li>
            <strong>Setup time</strong> is measured at the real socket, not in the browser. TCP includes the real
            3-way handshake; UDP always reports <code>0 ms</code> because there is nothing to measure.
          </li>
          <li>
            <strong>RTT</strong> is measured at the gateway socket from just before <code>socket.write()</code> to the
            moment the acknowledgement arrives. It deliberately excludes the browser↔gateway WebSocket hop so the two
            protocols are compared fairly.
          </li>
          <li>
            <strong>Overhead</strong> counts the bytes the protocol adds per message (transport + IPv4 header) plus the
            bytes spent on acknowledgements, which is where TCP's "free" ACKs still cost real bandwidth.
          </li>
        </ul>
      </Card>
    </Section>
  );
}