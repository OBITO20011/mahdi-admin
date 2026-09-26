import http from 'node:http';
import net from 'node:net';

const host = '127.0.0.1';
const port = Number(process.argv[2] ?? 4175);
const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);
const denied = [];

const isLoopback = (hostname) => loopbackHosts.has(
  hostname.replace(/^\[|\]$/gu, '').toLowerCase(),
);

const recordDenied = (method, target) => {
  denied.push({ method, target, at: new Date().toISOString() });
};

const server = http.createServer((request, response) => {
  request.on('error', () => response.destroy());
  response.on('error', () => response.destroy());
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ready: true }));
    return;
  }
  if (request.url === '/__network-guard/reset' && request.method === 'POST') {
    denied.length = 0;
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.url === '/__network-guard/status') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ denied }));
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
