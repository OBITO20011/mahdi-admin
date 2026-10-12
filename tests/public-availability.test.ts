import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {collectPublicAvailability, PUBLIC_SERVICES, REQUIRED_SECURITY_HEADERS} from '../scripts/monitoring/public-availability.mjs';
import {runIncidentCycle} from '../scripts/monitoring/developer-alert-core.mjs';

const headers = Object.fromEntries(REQUIRED_SECURITY_HEADERS.map(name => [name, 'test-policy']));
test('local public contract has exact same services and four headers as unchanged public uptime workflow', async () => {
  const source = await readFile('.github/workflows/public-uptime.yml', 'utf8');
  assert.deepEqual([...source.match(/for header in (.+); do/u)![1].split(' ')], [...REQUIRED_SECURITY_HEADERS]);
  assert.deepEqual(PUBLIC_SERVICES.map(s => s.url), ['https://admin.alnawasreh.com', 'https://alnawasreh.com']);
  for (const service of PUBLIC_SERVICES) assert.ok(source.includes(service.url));
  assert.match(source, /schedule:/u); assert.match(source, /workflow_dispatch:/u);
});
test('status exactly200 and every required non-empty header;204 and empty/missing headers fail', async () => {
  for (const status of [200, 204, 500]) {
    const [check] = await collectPublicAvailability({services: [PUBLIC_SERVICES[0]],
      fetchImpl: async () => new Response(null, {status, headers})});
    assert.equal(check.healthy, status === 200); assert.equal(check.details.httpStatus, status);
  }
  for (const missing of REQUIRED_SECURITY_HEADERS) {
    const remaining = {...headers}; delete remaining[missing];
    for (const incomplete of [remaining, {...remaining, [missing]: ''}]) {
      const [check] = await collectPublicAvailability({services: [PUBLIC_SERVICES[0]],
        fetchImpl: async () => new Response(null, {headers: incomplete})});
      assert.equal(check.healthy, false); assert.equal(check.details.missingHeaders, missing);
    }
  }
});
test('network/timeout failure preserves incident keys without recording raw error,URL or response', async () => {
  const checks = await collectPublicAvailability({fetchImpl: async () => { throw Error('secret-url?token=sensitive'); }});
  assert.deepEqual(checks.map(c => c.key), ['developer:uptime:admin', 'developer:uptime:customer']);
  assert.ok(checks.every(c => !c.healthy)); assert.doesNotMatch(JSON.stringify(checks), /secret|sensitive|token|https:/u);
});
test('real loopback HTTP200/redirect/missing header and existing alert dedup/recovery', async () => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.url === '/redirect') { res.writeHead(302, {...headers, location: '/missing'}); res.end(); return; }
    const result = {...headers}; if (req.url === '/missing') delete result['x-frame-options'];
    res.writeHead(200, result); res.end('must never be stored');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const run = (path: string) => collectPublicAvailability({services: [{key: 'admin', url: origin + path}]});
  try {
    const ok = await run('/ok'); assert.equal(ok[0].healthy, true);
    const failed = await run('/redirect'); assert.equal(failed[0].healthy, false);
    assert.equal(failed[0].details.missingHeaders, 'x-frame-options'); assert.equal(requests, 3);
    const kinds: string[] = [], send = async ({kind}: {kind: string}) => { kinds.push(kind); return true; };
    const now = new Date('2026-10-12T12:00:00Z');
    const first = await runIncidentCycle({checks: failed, send, now});
    const duplicate = await runIncidentCycle({checks: failed, state: first.state, send, now});
    await runIncidentCycle({checks: ok, state: duplicate.state, send, now});
    assert.deepEqual(kinds, ['incident', 'recovery']);
    assert.doesNotMatch(JSON.stringify(ok), /must never|127\.0\.0\.1/u);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
