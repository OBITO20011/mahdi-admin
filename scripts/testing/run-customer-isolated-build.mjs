import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const seen = {catalog: 0, offers: 0};
const fixtureProductId = 'ab130346-b2ed-4512-9001-cad03a65a6a4';
const server = createServer(async (request, response) => {
  const body = [];
  for await (const chunk of request) body.push(chunk);
  const route = request.url;
  response.setHeader('Content-Type', 'application/json');
  if (request.method !== 'POST' || request.headers.apikey !== 'isolated-seo-audit-key') {
    response.writeHead(403).end(JSON.stringify({error: 'invalid isolated request'}));
    return;
  }
  if (route === '/rest/v1/rpc/get_public_storefront_catalog_page') {
    const args = JSON.parse(Buffer.concat(body).toString('utf8'));
    assert.equal(args.p_availability, 'available');
    assert.equal(args.p_offset, 0);
    seen.catalog++;
    response.writeHead(200).end(JSON.stringify({
      limit: 48, offset: 0, total: 1,
      categories: [{id: '3ea4ed9f-04bd-4c88-9a26-c373dd513920', code: 'audit-category', nameAr: 'فئة اختبار', availableProductCount: 1}],
      items: [{id: fixtureProductId, sku: 'AUDIT-SKU', nameAr: 'منتج اختبار', description: 'منتج للبيئة المعزولة', isAvailable: true, salePackagePriceInMinorUnits: 1000}],
    }));
    return;
  }
  if (route === '/rest/v1/rpc/get_public_storefront_offers') {
    seen.offers++;
    response.writeHead(200).end(JSON.stringify({offers: []}));
    return;
  }
  response.writeHead(404).end(JSON.stringify({error: 'unexpected RPC'}));
});

try {
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const env = {...process.env,
    NAWASRAH_SEO_AUDIT_API_URL: `http://127.0.0.1:${address.port}`,
    NAWASRAH_SEO_AUDIT_API_KEY: 'isolated-seo-audit-key',
  };
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd --prefix customer-web run build']
    : ['--prefix', 'customer-web', 'run', 'build'];
  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd: root, env, stdio: 'inherit'});
    child.on('error', reject);
    child.on('close', resolve);
  });
  assert.equal(result, 0, 'Customer build failed');
  assert.equal(seen.catalog, 1, 'Isolated catalog RPC was not used exactly once');
  assert.equal(seen.offers, 1, 'Isolated offers RPC was not used exactly once');
  console.log('Isolated Customer build and SEO verification PASS (no Production API reads).');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
