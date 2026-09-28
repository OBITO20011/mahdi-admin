import http from 'node:http';
import net from 'node:net';

const host = '127.0.0.1';
const port = Number(process.argv[2] ?? 4175);
const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);
const denied = [];
const expectedBlockedCanaries = new Set();
const blockedCanaryAttempts = [];
const deniedUnexpectedAttempts = [];
const escapedExternalRequests = [];

const isLoopback = (hostname) => loopbackHosts.has(
  hostname.replace(/^\[|\]$/gu, '').toLowerCase(),
);

const signatureFor = (method, target) => `${method.toUpperCase()}\0${target}`;

const recordDenied = (method, target) => {
  const event = { method: method.toUpperCase(), target, at: new Date().toISOString() };
  denied.push(event);
  if (expectedBlockedCanaries.has(signatureFor(event.method, event.target))) {
    blockedCanaryAttempts.push(event);
  } else {
    deniedUnexpectedAttempts.push(event);
  }
};

const readJsonBody = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error('Network guard control payload is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const server = http.createServer(async (request, response) => {
  request.on('error', () => response.destroy());
  response.on('error', () => response.destroy());
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ready: true }));
    return;
  }
  if (request.url === '/__network-guard/reset' && request.method === 'POST') {
    denied.length = 0;
    expectedBlockedCanaries.clear();
    blockedCanaryAttempts.length = 0;
    deniedUnexpectedAttempts.length = 0;
    escapedExternalRequests.length = 0;
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.url === '/__network-guard/expect-blocked-canary' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      if (
        typeof body?.method !== 'string' ||
        typeof body?.target !== 'string' ||
        body.method.length === 0 ||
        body.target.length === 0
      ) {
        throw new Error('A method and exact target are required.');
      }
      expectedBlockedCanaries.add(signatureFor(body.method, body.target));
      response.writeHead(204);
      response.end();
    } catch {
      response.writeHead(400);
      response.end('Invalid blocked-canary registration');
    }
    return;
  }
  if (request.url === '/__network-guard/status') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      denied,
      blockedCanaryAttempts,
      deniedUnexpectedAttempts,
      escapedExternalRequests,
    }));
    return;
  }

  let target;
  try {
    target = new URL(request.url ?? '', `http://${request.headers.host ?? ''}`);
  } catch {
    response.writeHead(400);
    response.end('Invalid proxy target');
    return;
  }
  if (!isLoopback(target.hostname)) {
    recordDenied(request.method ?? 'GET', target.origin + target.pathname);
    response.writeHead(403, { 'content-type': 'text/plain' });
    response.end('Browser QA network guard blocked non-loopback traffic');
    return;
  }

  // Only loopback targets reach this forwarding boundary. A non-loopback
  // request can therefore never be classified as escaped merely because the
  // browser attempted it.
  const upstream = http.request({
    hostname: target.hostname,
    port: target.port || 80,
    path: `${target.pathname}${target.search}`,
    method: request.method,
    headers: { ...request.headers, host: target.host },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end('Loopback proxy target unavailable');
  });
  request.pipe(upstream);
});

server.on('connect', (request, clientSocket, head) => {
  clientSocket.on('error', () => clientSocket.destroy());
  const authority = request.url ?? '';
  const separator = authority.lastIndexOf(':');
  const hostname = authority.slice(0, separator).replace(/^\[|\]$/gu, '');
  const targetPort = Number(authority.slice(separator + 1));
  if (!isLoopback(hostname) || !Number.isInteger(targetPort)) {
    recordDenied('CONNECT', authority);
    clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  const upstream = net.connect(targetPort, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
});
server.on('clientError', (_error, socket) => socket.destroy());

server.listen(port, host, () => {
  process.stdout.write(`Browser QA network guard listening on http://${host}:${port}\n`);
});

const stop = () => server.close(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
