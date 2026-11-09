# Socket.IO webhook relay

A standalone Express + Socket.IO service. n8n posts a JSON message to
`POST /webhook`; the relay emits that message as `n8n_response` to the room
identified by `sessionDetails.sessionId`.

No database, volume, API key, or connection to the portal repository is needed
to run this relay. It is not an n8n server.

## Deploy on Railway

1. Create a service using **Deploy from GitHub repo** and select
   `nnoronha12/socket`, branch `main`.
2. Use the repository root. Railway detects the root `Dockerfile`; leave build
   and start-command overrides empty.
3. Set the health-check path to `/health` and run **one replica**.
4. Generate a public domain and point its target port at the application's
   `PORT`. The Dockerfile defaults to `3001`; if Railway supplies another `PORT`,
   the server uses it.
5. Point the browser Socket.IO client at the domain origin. Point n8n at the
   same origin followed by `/webhook`.

Railway Dockerfile reference: <https://docs.railway.com/builds/dockerfiles>.

## Deploy with Docker

```sh
docker build -t socket-relay .
docker run --rm -p 3001:3001 -e PORT=3001 socket-relay
```

For an existing Docker host, use its ingress/load balancer for HTTPS and
WebSocket upgrades. Forward traffic to the container's `PORT`.

## Run locally

Node.js 22 or later:

```sh
npm ci
npm test
npm start
```

The default port is `3001`. Override it with the `PORT` environment variable.

## HTTP and Socket.IO routes

| Route | Purpose |
| --- | --- |
| `GET /` | Server information |
| `GET /health` | Health, tracked client count, and session IDs |
| `POST /webhook` | Accept a message from n8n and emit `n8n_response` |
| `/socket.io/` | Socket.IO transport path, including polling and WebSocket upgrade |

`/socket.io/` is a transport path. Send ordinary n8n JSON POST requests to
`/webhook`, not to `/socket.io/` or `/socket`. Sending JSON to the transport
handler can produce `400 Transport unknown`.

If an ingress exposes a prefix, configure rewrites explicitly so the application
still receives `/socket.io/` for transport and `/webhook` for relay POSTs. A
renamed public prefix does not create a corresponding Express route.

### Browser connection

Install `socket.io-client` in the browser application:

```js
import { io } from 'socket.io-client';

const socket = io('https://YOUR-RELAY-DOMAIN', {
  path: '/socket.io/',
  transports: ['polling', 'websocket'],
});

socket.on('connect', () => {
  socket.emit('join', { sessionId: 'synthetic-test-session' });
});

socket.on('n8n_response', message => {
  console.log(message);
});

// When switching away from the session:
// socket.emit('leave', { sessionId: 'synthetic-test-session' });
```

### n8n request

Use an HTTP Request node with method `POST`, URL
`https://YOUR-RELAY-DOMAIN/webhook`, and a JSON body:

```json
{
  "output": "Synthetic relay test",
  "sessionDetails": {
    "sessionId": "synthetic-test-session",
    "chatLock": false
  },
  "actionButtons": {
    "buttons": []
  }
}
```

The session ID must match the browser room. Other message fields pass through
unchanged. Missing `sessionDetails.sessionId` returns HTTP 400.
HTTP 200 confirms the relay accepted the message; it does not prove a browser
was connected or consumed it.

## Deployment characteristics

This preserves the original relay's behavior: wildcard CORS, no built-in
authentication, full webhook-payload logging, and session IDs exposed by
`/health`. Deployment access controls belong at the surrounding infrastructure
unless the server is extended. The webhook should be reachable by trusted
backend callers; room membership is not a user-authorization check.

Rooms are held in process memory. Multiple replicas require a shared adapter
and appropriate transport routing; use one replica with this version. The
`clients` map tracks one socket per session, so its count is diagnostic rather
than an authoritative count of browser connections.

## Source provenance and verification

`server.js` is unchanged from the original local WebSocket deployment pack.
Two independently saved copies of that file matched byte-for-byte. SHA-256:

```text
883dcadb6fd01c02d753bad7717faf3bb7faadab2757f156fed7e54a12014e59
```

The original Railway server's public root returned the matching server-info
and route descriptions on 9 November 2026. Its service was not in the accessible
Railway project inventory, so the running image, deployment commit, and original
GitHub link could not be independently verified. This repository packages the
recovered source; it is not a claim of an exact export of the running image.

The original pack used Express 4.18.2, Socket.IO 4.7.2 and CORS 2.8.5. This
repository pins compatible releases in the same major versions and includes a
lockfile. Tests cover root/health, missing session IDs, room-specific webhook
delivery, and room leave behavior using synthetic data only.
