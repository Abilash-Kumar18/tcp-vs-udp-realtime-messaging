# TCP vs UDP — Real-Time Messaging over Two Protocols

A working real-time messaging application implemented **twice** — once over **TCP**
(`net.createServer`) and once over **UDP** (`dgram.createSocket`) — wrapped in an
interactive website that lets you watch both versions side by side and *measure* the
difference instead of taking it on faith.

The site answers the four questions the assignment asks about connection
establishment, reliability, ordering and communication overhead, using real sockets
on real ports. Nothing is faked except the things a loopback network physically
cannot do (see [Honesty notes](#honesty-notes)).

```
npm install
npm run serve          # builds the site, then serves everything on :3000
```

Then open <http://localhost:3000>.

---

## 1. Quick start

### Option A — one command, everything on port 3000 (recommended for demos)

```bash
npm install
npm run serve
```

* `npm run serve` = `npm run build` (Vite bundles the React app into `client/dist`)
  followed by `npm start` (the Node gateway).
* Open **<http://localhost:3000>**. The gateway serves the built site, the REST API,
  the WebSocket and both backend sockets.

### Option B — development mode with hot reload

```bash
npm install
npm run dev
```

* Gateway: <http://127.0.0.1:3000> (auto-restarts on server changes)
* Vite dev server: **<http://localhost:5173>** ← open this one
* Vite proxies `/api` and `/ws` to the gateway, so the browser still sees a single
  origin. Point it elsewhere with `GATEWAY=http://host:port npm run dev`.

> Port 3000 serves the built site whenever `client/dist` exists. If you have never
> run `npm run build`, the gateway answers `/` with a short "Gateway is running"
> page that points you at 5173 — that is intentional, not a crash.

### Requirements

* **Node.js 18 or newer** (`node --version`). No Docker, no database, no native modules.
* Three free local ports: **3000** (HTTP + WebSocket), **4001** (TCP), **4002** (UDP).

---

## 2. What is actually running

One Node process hosts three tiers, so there is nothing else to start:

| Tier | Technology | Port | Job |
| --- | --- | --- | --- |
| Gateway | Express + `ws` | **3000** | Serves the website, exposes the REST API, bridges the browser to the backends over a WebSocket |
| TCP backend | `net.createServer()` | **4001** | Connection-oriented chat server: 3-way handshake, ordered byte stream, ACKs |
| UDP backend | `dgram.createSocket('udp4')` | **4002** | Connectionless chat server: no handshake, per-datagram delivery, app-level ACKs |

```
browser ──── WebSocket (TCP) ────▶ gateway :3000
                                     │
                                     ├── net.Socket   ──▶ TCP backend :4001   (ordered, reliable)
                                     └── dgram.Socket ──▶ UDP backend :4002   (lossy, unordered)
```

A browser cannot open raw TCP or UDP sockets, so the first hop is necessarily
WebSocket/HTTP. Everything the demo measures happens on the **second** hop
(gateway → backend), which is a genuine socket of the protocol under test. The
website's Architecture section states this on screen so nobody misreads the
numbers.

---

## 3. Project structure

```
.
├── package.json                 # npm workspaces + all commands
├── README.md
├── vercel.json                  # builds and serves the static site on Vercel
├── render.yaml                  # blueprint: the gateway (real TCP + UDP sockets) on Render
├── test/
│   └── run-all.mjs              # starts a throwaway gateway and runs every suite
├── server/
│   ├── package.json
│   └── src/
│       ├── index.js             # gateway: Express API, /ws, experiment orchestration
│       ├── config.js            # ports, defaults, source whitelist (env-configurable)
│       ├── protocol.js          # wire format, header/ACK byte constants, frame decoder
│       ├── tcp-backend.js       # net.createServer  — TCP chat server
│       ├── udp-backend.js       # dgram.createSocket — UDP chat server + loss injection
│       ├── tcp-link.js          # net.Socket client — handshake, send, RTT, metrics
│       ├── udp-link.js          # dgram client — register, send, app-level ACK, drop notices
│       ├── experiment.js        # the N-message burst and the report it produces
│       ├── metrics.js           # counters, RTT percentiles, overhead accounting
│       ├── chaos.js             # the live "network simulation" knobs
│       └── logger.js            # colourised logging (packet trace behind a flag)
│   └── test/
│       └── smoke.mjs            # 21 end-to-end backend checks
└── client/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── src/
    │   ├── main.jsx
    │   ├── App.jsx              # state owner, WebSocket lifecycle, section order
    │   ├── gateway.js           # createConnection(), chaos API, source API
    │   ├── styles.css           # design system (blue = TCP, orange = UDP, responsive)
    │   ├── lib/
    │   │   ├── ui.jsx           # Section, Card, Badge, Stat, Table, formatters
    │   │   └── highlight.jsx    # dependency-free JS syntax highlighter
    │   └── sections/
    │       ├── Overview.jsx         # 01 — what the app is, TCP vs UDP at a glance
    │       ├── Architecture.jsx     # 02 — the diagram, message lifecycle, frame layout
    │       ├── LiveDemo.jsx         # 03 — two chat panels, connect / type / send / logs
    │       ├── Experiments.jsx      # 04 — chaos knobs, N-message bursts, comparison table
    │       ├── CodeShowcase.jsx     # 05 — real server source, loaded over HTTP
    │       └── ReportHelp.jsx       # 06 — how to write the report around these results
    └── test/
        ├── render-check.mjs     # 6 server-side render + highlighter checks
        └── ui-test.mjs          # 34 real DOM interaction checks (jsdom + live gateway)
```

The Code Showcase reads the four socket files **over HTTP from disk at runtime**
(`/api/source/:file`, whitelisted), so the code on the page is always the code that
is running — the snippets cannot drift out of date.

---

## 4. Running the experiment (what to put in the report)

1. `npm run serve` and open <http://localhost:3000>, then scroll to **04 — Experiment & metrics**.
2. Leave the network simulation at its defaults (**8 % UDP message loss, 8 % ACK
   loss, 5 % reordering, no added latency**).
3. Press **Run experiment** on the **TCP** card: 100 messages of 32 B are pushed
   through a freshly opened socket as fast as possible.
4. Press **Run experiment** on the **UDP** card with the same settings. The
   side-by-side table only fills in once **both** runs exist.
5. Read off the four areas the assignment asks for:

| Question | Rows to quote in the report |
| --- | --- |
| Connection establishment | *Handshake*, *Total setup*, *Round trips before 1st message* |
| Reliability | *Messages sent / acknowledged / lost*, *Delivery rate* |
| Delivery & ordering | *Delivered in send order*, *Out-of-order arrivals* |
| Communication overhead | *Header per message*, *ACK traffic*, *Total overhead / payload*, *Bytes on the wire* |

Then repeat with a preset such as **Mobile / Wi-Fi** (10 % loss, 35 ms RTT) to show
how the gap between the two protocols widens as the network degrades, and quote both
sets of numbers. Section **06 — Explanation & report help** contains paragraph
templates, a suggested structure and the wording for each conclusion.

Every run opens a **new socket** (TCP handshake timed from scratch each time) on a
throwaway link, so your live chat session and its measurements are never disturbed.

### Reading the numbers

* **Handshake** — TCP: wall-clock time of `socket.connect()`, i.e. SYN → SYN-ACK →
  ACK, plus the simulated WAN RTT if you set that knob. UDP: structurally `0 ms`;
  there is nothing to set up.
* **Setup** — from "start connecting" to "the app is registered and can send".
  TCP pays its handshake *plus* this app's own REGISTER round trip; UDP pays only
  the REGISTER round trip.
* **RTT** — measured from `send()` to the matching acknowledgement arriving back, at
  the gateway → backend hop.
* **Header bytes** — TCP `20 B header + 20 B IPv4 = 40 B`; UDP `8 B header + 20 B IPv4
  = 28 B`. The table also counts pure-ACK link cost (54 B for a TCP ACK, 42 B for a
  UDP ACK datagram) so "overhead" includes the return traffic, not just the request.
* **Lost** — a message is lost when no acknowledgement arrives within the ACK timeout
  (2.5 s by default). The UI also lists *which* sequence numbers never came back,
  which is the evidence a UDP application would need in order to recover them.

Typical result on loopback at the defaults: TCP 100 % delivered and in order with a
handshake of a few milliseconds; UDP roughly 80–90 % delivered with visible
out-of-order arrivals and a 0 ms handshake.

---

## 5. Honesty notes

A loopback network does not drop, delay or reorder packets, so a naive
TCP-vs-UDP demo on `127.0.0.1` shows "both perfect" and proves nothing. To make the
properties visible, the backends inject them deliberately, and the site says so on
screen:

* **Loss, ACK loss and reordering are injected by the UDP backend only.** TCP cannot
  be made lossy this way — that is the entire point of it — so the knobs are labelled
  "UDP only".
* **Simulated latency is applied to both protocols**, so the comparison stays fair.
* **"Simulated TCP handshake RTT" is added to TCP's measured connect time only**, to
  imitate a handshake across a real network. UDP has no handshake to slow down.
* Defaults are deliberately unflattering (`0 ms` added latency), so the numbers you
  record are the honest loopback measurements, not an artificially bad network.
* The browser → gateway hop is WebSocket, which is itself reliable and ordered TCP.
  That is why loss, reordering and overhead are reported for the gateway → backend
  socket hop, where the protocol under test actually lives.

---

## 6. HTTP API

| Method & path | Purpose |
| --- | --- |
| `GET /api/health` | Liveness probe and uptime |
| `GET /api/config` | Ports, header sizes, protocol defaults |
| `GET /api/stats` | Live TCP connections and UDP client count |
| `GET /api/chaos` | Current network-simulation values plus defaults |
| `POST /api/chaos` | Update any subset of the knobs (takes effect immediately) |
| `POST /api/chaos/reset` | Restore defaults |
| `POST /api/reset/:proto` | Zero the counters for one protocol |
| `GET /api/source/:file` | Real source for the Code Showcase (whitelisted files only; add `?download=1` to save the file) |
| `WS /ws` | Bidirectional JSON frames. Client sends `connect`, `send`, `disconnect`, `reset`, `experiment`, `ping`; server replies with `welcome`, `status`, `metrics`, `log`, `backend`, `chaos`, `experiment-progress`, `experiment-result`, `error`, `pong` |

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Gateway HTTP + WebSocket port |
| `TCP_PORT` | `4001` | TCP backend port |
| `UDP_PORT` | `4002` | UDP backend port |
| `HOST` | `127.0.0.1` | Interface all three bind to |
| `UDP_DROP` | `0.08` | Default UDP message-loss probability |
| `UDP_ACK_DROP` | `0.08` | Default UDP acknowledgement-loss probability |
| `UDP_REORDER` | `0.05` | Default UDP reordering probability |
| `LATENCY_MS` | `0` | Extra one-way delay applied to **both** backends |
| `TCP_HANDSHAKE_RTT_MS` | `0` | Added to TCP's measured handshake |
| `ACK_TIMEOUT_MS` | `2500` | How long to wait for an ACK before declaring a message lost |
| `DEBUG_MESSAGES` | unset | `1` prints a packet-level trace of every frame |
| `GATEWAY` | `http://127.0.0.1:3000` | Vite dev proxy target |
| `VITE_GATEWAY_URL` | unset | **Build-time** client variable: address of the gateway when the site and the gateway are deployed separately |

---

## 7. Deploying

The two halves have to live on different platforms, and the reason is the whole
point of the project:

> **Vercel cannot run these backends.** Its serverless runtime cannot bind a
> listening TCP socket or a UDP socket, so `net.createServer` (:4001) and
> `dgram.createSocket` (:4002) have nowhere to run. What Vercel *can* serve is the
> static React site — which is what it does here.

| Piece | Host | Why there |
| --- | --- | --- |
| React site (static) | **Vercel** | A build-and-serve CDN is exactly what it is good at. Configured by `vercel.json`. |
| Node gateway + TCP :4001 + UDP :4002 | **Render** | An ordinary long-running Linux process, so raw sockets and WebSockets both work. Configured by `render.yaml`. |

### 1. Deploy the gateway to Render

Push the repository, then on Render choose **New → Blueprint** and point it at the
repo. `render.yaml` declares the service, its health check (`/api/health`) and the
chaos defaults. When it finishes you get a URL such as
`https://cn4-gateway.onrender.com`.

> The free plan sleeps after ~15 minutes idle, so the first visitor after a quiet
> period waits for a cold start (tens of seconds) and the badge in the top-left
> stays red until the gateway answers. Use a paid instance for a permanently warm demo.

### 2. Deploy the site to Vercel

```bash
npm i -g vercel
vercel login
vercel --prod
```

`vercel.json` runs `npm --workspace client run build` and publishes `client/dist`.
To point the site at the Render gateway, set the build-time variable first — in the
Vercel project under **Settings → Environment Variables**, or in the CLI:

```bash
vercel --prod --build-env VITE_GATEWAY_URL=https://cn4-gateway.onrender.com
```

With `VITE_GATEWAY_URL` unset the site assumes the gateway is on its own origin,
which is exactly what `npm run serve` does locally — so one codebase covers local
development and the deployed split without any code changes.

Because the gateway sets permissive CORS headers and the WebSocket handshake accepts
any origin, the cross-origin hop works. When it is configured, the site shows the
gateway's host next to the status badge, so it is always obvious where the real
sockets live.

### 3. Verify the deployed pair

`npm test` runs the interaction suite twice: once with the page and the gateway on
one host, and once with the page on a different host (exactly the Vercel + Render
shape). Both must be green before you trust a deployment.

---

## 8. Tests

```bash
npm test              # all four suite runs (95 checks) — starts and stops its own gateway
```

`npm test` needs nothing running: `test/run-all.mjs` starts a throwaway gateway on
private ports (3100 / 4101 / 4102), runs the suites below against it, and shuts it
down. If a gateway is already listening on port 3100 it is reused and left alone, so
testing never disturbs a running demo.

Individual suites (each one expects a gateway at `BASE`, default <http://127.0.0.1:3000>):

```bash
npm run test:server   # 21 end-to-end backend checks
npm run test:render   # 6 server-render + syntax-highlighter checks (no server needed)
npm run test:ui       # 34 real DOM interaction checks
```

* **`server/test/smoke.mjs`** opens real sockets against the gateway and asserts the
  numbers that matter: the advertised ports and header sizes, TCP handshake > 0, UDP
  handshake = 0, an ACK for every TCP message, in-order delivery, 40 B vs 28 B headers,
  an error when sending on an unregistered session, 100 % loss → nothing delivered, and
  partial delivery at 50 % loss.
* **`client/test/render-check.mjs`** server-renders the whole app to catch render
  errors, and verifies every section, both demo panels and experiment runners, the
  header sizes in the comparison table, and that the highlighter escapes HTML.
* **`client/test/ui-test.mjs`** runs the real React app inside jsdom against the live
  gateway: it clicks the actual buttons and asserts on the actual DOM — inputs disabled
  until connected, both panels connecting, a message and its ACK in each log, injected
  loss appearing in the UDP log only, the MTU guard rejecting a 2 KB datagram over UDP
  while TCP accepts it, chaos sliders reflecting server state, and a full pair of
  experiments producing a comparison table with 0 TCP losses and > 0 UDP losses.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `EADDRINUSE` on 3000/4001/4002 | Another copy is still running. Stop it, or move the ports:<br>POSIX `PORT=3100 TCP_PORT=4101 UDP_PORT=4102 npm start` · PowerShell `$env:PORT=3100; $env:TCP_PORT=4101; $env:UDP_PORT=4102; npm start` |
| Port 3000 shows "Gateway is running" | No production build yet — open **5173** in dev mode, or run `npm run build` |
| WebSocket says "Gateway offline" | The gateway is not running, or the page was opened from an origin the proxy does not cover (`GATEWAY=…`). On a deployed site, check that `VITE_GATEWAY_URL` points at the Render URL |
| Deployed site renders but every socket hangs | `VITE_GATEWAY_URL` is missing or wrong. It is a **build-time** variable — rebuild/redeploy the site after changing it |
| Render gateway never becomes healthy | Its health check polls `/api/health`; watch the Render logs. Remember the free plan sleeps when idle |
| Measured RTT looks absurdly high (100 ms+) | Console logging is blocking the event loop. Leave `DEBUG_MESSAGES` unset; if you redirect output to a file on Windows, be aware that redirected stdout is synchronous |
| Every UDP message arrives, no loss visible | Loss defaults to 8 %. Raise the **UDP message loss** knob in section 04, or restart with `UDP_DROP=0.5` (`$env:UDP_DROP=0.5` in PowerShell) |
| The Code Showcase says the file is not allowed | Only `tcp-backend.js`, `udp-backend.js`, `tcp-link.js` and `udp-link.js` are whitelisted — by design |