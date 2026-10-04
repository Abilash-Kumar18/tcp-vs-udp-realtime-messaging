import React from 'react';
import { Section, Card, Badge, Note } from '../lib/ui.jsx';

/**
 * Report helper. Everything here is phrased so it can be pasted into a lab
 * report and then defended with the numbers the Experiments section produced.
 */
export default function ReportHelp({ reports }) {
  const filled = ['tcp', 'udp'].filter((p) => reports[p]);

  return (
    <Section
      id="report"
      eyebrow="06 — Write-up"
      title="Explanation & report help"
      lead="A ready-made mapping from what you just observed to the theory behind it. Run the experiments first, then replace the bracketed placeholders with your own measured numbers."
    >
      {filled.length === 0 ? (
        <Note tone="info">
          <strong>Tip:</strong> run both experiments in the previous section first. This page can quote your own measured
          values back at you, which is what makes a report convincing.
        </Note>
      ) : (
        <Card tight>
          <div className="card-title">
            <h4>Your measured figures, ready to quote</h4>
            <Badge tone="ok">{filled.length}/2 complete</Badge>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Sentence starter</th>
                  <th scope="col" className="tcp-col">
                    TCP
                  </th>
                  <th scope="col" className="udp-col">
                    UDP
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Establishing the connection took…</th>
                  <td className="metric tcp-col">{fmt(reports.tcp, (r) => `${r.handshakeMs} ms of handshake, ${r.setupMs} ms total setup`)}</td>
                  <td className="metric udp-col">{fmt(reports.udp, (r) => `${r.handshakeMs} ms of handshake (none required), ${r.setupMs} ms total setup`)}</td>
                </tr>
                <tr>
                  <th scope="row">Of {reports.tcp?.n ?? 'N'} messages sent…</th>
                  <td className="metric tcp-col">{fmt(reports.tcp, (r) => `${r.acked} acknowledged, ${r.lost} lost (${r.deliveryRate}% delivery)`)}</td>
                  <td className="metric udp-col">{fmt(reports.udp, (r) => `${r.acked} acknowledged, ${r.lost} lost (${r.deliveryRate}% delivery)`)}</td>
                </tr>
                <tr>
                  <th scope="row">Messages arrived in send order?</th>
                  <td className="metric tcp-col">{fmt(reports.tcp, (r) => (r.inOrder ? 'Yes, always' : `No (${r.outOfOrder} out of order)`))}</td>
                  <td className="metric udp-col">{fmt(reports.udp, (r) => (r.inOrder ? 'Yes, always' : `No (${r.outOfOrder} arrived out of order)`))}</td>
                </tr>
                <tr>
                  <th scope="row">Average round trip was…</th>
                  <td className="metric tcp-col">{fmt(reports.tcp, (r) => `${r.avgRttMs} ms`)}</td>
                  <td className="metric udp-col">{fmt(reports.udp, (r) => `${r.avgRttMs} ms`)}</td>
                </tr>
                <tr>
                  <th scope="row">Protocol overhead per message cost…</th>
                  <td className="metric tcp-col">{fmt(reports.tcp, (r) => `${r.overhead.headerBytes} B of header, ${r.overhead.overheadRatio}× the payload in total`)}</td>
                  <td className="metric udp-col">{fmt(reports.udp, (r) => `${r.overhead.headerBytes} B of header, ${r.overhead.overheadRatio}× the payload in total`)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid grid-2" style={{ marginTop: '1.1rem' }}>
        {/* ---------------- connection establishment ---------------- */}
        <Card tone="tcp">
          <div className="card-title">
            <h3>1. Connection establishment</h3>
            <Badge tone="tcp">SYN · SYN-ACK · ACK</Badge>
          </div>
          <ul className="reasons">
            <li>
              <strong>TCP is connection-oriented.</strong> Before any data moves, the client and server exchange a
              three-way handshake: <code>SYN</code>, <code>SYN-ACK</code>, <code>ACK</code>. That is one full round trip
              spent before the first message, and the connection then exists as kernel state on both machines.
            </li>
            <li>
              <strong>UDP is connectionless.</strong> No handshake occurs at all. The socket is bound locally and the first
              datagram is simply handed to the IP layer. "Registering" in this demo is an application-level courtesy, not a
              protocol feature — which is why its handshake figure is always exactly{' '}
              <code>0 ms</code>.
            </li>
            <li>
              <strong>Consequence for latency.</strong> TCP needs at least two round trips before useful data flows: one
              for the handshake and one for this application's own registration. UDP needs one, or zero if the application
              skips registration. On a 50 ms path that is up to 100 ms of dead time for TCP and none for UDP.
            </li>
            <li>
              <strong>Consequence for state.</strong> Because TCP connections are stateful, the server holds one socket per
              client and must manage them. UDP has a single socket and no notion of a connection to leak — but also no{' '}
              <code>close</code> event, so the server cannot know when a client disappears.
            </li>
          </ul>
        </Card>

        {/* ---------------- reliability and ordering ---------------- */}
        <Card tone="udp">
          <div className="card-title">
            <h3>2. Reliability &amp; ordering</h3>
            <Badge tone="udp">best effort</Badge>
          </div>
          <ul className="reasons">
            <li>
              <strong>TCP guarantees both.</strong> Sequence numbers plus cumulative acknowledgements let the receiver
              detect gaps, and the sender retransmits until they are filled. Bytes therefore arrive exactly once and in
              order, without the application writing a single line of retry logic.
            </li>
            <li>
              <strong>UDP guarantees neither.</strong> A datagram can be lost, duplicated or delivered out of order, and
              the sender is told nothing. In the demo, red <code>LOST</code> lines are datagrams the simulation discarded;
              no such line can ever appear in the TCP log.
            </li>
            <li>
              <strong>Acknowledgements are not free.</strong> TCP acknowledges every segment automatically at kernel level.
              In UDP there is no ACK until the application builds one — costing an entire extra datagram that can{' '}
              <em>itself</em> be lost. The demo's "ACK lost" lines show exactly this: the server received the message, but
              the client is now waiting for a reply that will never come.
            </li>
            <li>
              <strong>How real UDP apps cope.</strong> They add the missing guarantees themselves: sequence numbers,
              acknowledgements, timers and retransmission — which is precisely how protocols such as QUIC are built on top of
              UDP. They simply omit whatever they do not need, such as head-of-line blocking.
            </li>
          </ul>
        </Card>

        {/* ---------------- overhead ---------------- */}
        <Card tone="tcp">
          <div className="card-title">
            <h3>3. Communication overhead</h3>
            <Badge tone="tcp">40 B / message</Badge>
          </div>
          <ul className="reasons">
            <li>
              <strong>Headers.</strong> Every TCP segment carries a 20-byte TCP header on top of the 20-byte IPv4 header —
              40 bytes of overhead per message. UDP carries only 8 bytes plus the same 20-byte IP header, so 28 bytes. TCP's
              header holds ports, sequence and acknowledgement numbers, window size and flags that UDP does not need.
            </li>
            <li>
              <strong>Acknowledgement traffic.</strong> Each TCP ACK is a header-only segment: about 40 bytes on the link
              for zero payload. TCP therefore spends roughly a third of all its bandwidth on ACKs when messages are small.
              A UDP ACK costs 28 bytes of header plus the payload of the ACK itself.
            </li>
            <li>
              <strong>Handshake bytes.</strong> A TCP handshake also costs three segments plus connection metadata such as
              MSS and window-scale options. UDP's equivalent cost is genuinely zero.
            </li>
            <li>
              <strong>Why it still wins on the web.</strong> Overhead only matters when messages are small or bandwidth is
              scarce. For large transfers the fixed 12-byte difference is irrelevant, while TCP's retransmission is worth far
              more than 12 bytes. This is why the cost model — not the feature list — decides the protocol.
            </li>
          </ul>
        </Card>

        {/* ---------------- when to use which ---------------- */}
        <Card>
          <div className="card-title">
            <h3>4. Choosing between them</h3>
            <Badge tone="mute">conclusion</Badge>
          </div>
          <ul className="reasons">
            <li>
              <strong>Use TCP</strong> when completeness is non-negotiable and one late packet is worse than a stall:
              web pages, email, file transfer, databases, remote shells. Head-of-line blocking is an acceptable price.
            </li>
            <li>
              <strong>Use UDP</strong> when staleness is worse than loss: voice and video calls, live game state, sensor
              telemetry, DNS lookups. Fresh data that arrives on time beats complete data that arrives too late.
            </li>
            <li>
              <strong>Use QUIC (UDP + reliability)</strong> when you want TCP's guarantees without TCP's costs: per-stream
              loss recovery avoids head-of-line blocking, and connection migration survives network changes.
            </li>
            <li>
              <strong>Answer to expect in a viva:</strong> neither protocol is "better". The choice is a trade between
              guaranteed delivery and bounded latency — and the experiments above let you quote numbers for both sides of
              that trade.
            </li>
          </ul>
        </Card>
      </div>

      <Card style={{ marginTop: '1.1rem' }}>
        <div className="card-title">
          <h3>Suggested report structure</h3>
          <Badge tone="mute">5 sections</Badge>
        </div>
        <ol className="reasons">
          <li>
            <strong>Aim.</strong> Implement the same real-time messaging application twice — once over TCP, once over UDP —
            and compare connection establishment, reliability, delivery and overhead.
          </li>
          <li>
            <strong>Method.</strong> Node backend with <code>net.createServer()</code> on TCP port 4001 and{' '}
            <code>dgram.createSocket('udp4')</code> on UDP port 4002; an Express + WebSocket gateway on port 3000 relays
            browser traffic onto those real sockets. RTT measured at the socket from <code>write()</code> to ACK arrival.
          </li>
          <li>
            <strong>Results.</strong> Paste the side-by-side table from the Experiments section, plus a screenshot of the two
            demo logs showing the TCP panel with zero lost messages and the UDP panel with red loss lines.
          </li>
          <li>
            <strong>Discussion.</strong> Sections 1–3 above, each backed by your own measured figures.
          </li>
          <li>
            <strong>Conclusion.</strong> Reliability and ordering are bought with round trips and bytes; connectionless
            transport is preferred when latency matters more than completeness.
          </li>
        </ol>
      </Card>
    </Section>
  );
}

function fmt(report, fn) {
  if (!report) return '— not measured yet —';
  return fn(report);
}