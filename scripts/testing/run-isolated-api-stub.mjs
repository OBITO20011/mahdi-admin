import http from 'node:http';

const host = '127.0.0.1';
const port = Number(process.argv[2] ?? 4176);
const server = http.createServer((request, response) => {
  request.on('error', () => response.destroy());
  response.on('error', () => response.destroy());
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ready: true }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'unconfigured isolated endpoint' }));
});
server.on('clientError', (_error, socket) => socket.destroy());

server.listen(port, host, () => {
  process.stdout.write(`Isolated browser API stub listening on http://${host}:${port}\n`);
});

const stop = () => server.close(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
