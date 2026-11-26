import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogRequestGate } from '../src/utils/catalogRequestGate';
import { readCatalog225, readOperatingCatalog, type CatalogRpc } from '../src/utils/operatingRead';

test('a search edit cancels the running read before the next search starts', async () => {
  const requests = createCatalogRequestGate();
  const published: string[] = [];
  let signal!: AbortSignal;
  let finishOld!: () => void;
  const waitingForOld = new Promise<void>(resolve => { finishOld = resolve; });

  const old = requests.run('old', async (requestSignal) => {
    signal = requestSignal;
    await waitingForOld;
    if (!requestSignal.aborted) published.push('old');
  });
  await Promise.resolve();
  requests.cancel();
  assert.equal(signal.aborted, true);

  await requests.run('latest', async requestSignal => {
    if (!requestSignal.aborted) published.push('latest');
  });
  finishOld();
  await old;
  assert.deepEqual(published, ['latest']);
});

test('an obsolete read completing after a clear and retype cannot release the new identical read', async () => {
  const requests = createCatalogRequestGate();
  let finishFirst!: () => void;
  let finishLatest!: () => void;
  const first = requests.run('same', () => new Promise<void>(resolve => { finishFirst = resolve; }));
  await Promise.resolve();
  requests.cancel();
  const latest = requests.run('same', () => new Promise<void>(resolve => { finishLatest = resolve; }));
  await Promise.resolve();

  finishFirst();
  await first;
  assert.equal(requests.run('same', async () => assert.fail('duplicate read')), latest);
  finishLatest();
  await latest;
});

test('a catalog cancellation is carried through older read contracts and stops new fallback reads', async () => {
  const controller = new AbortController();
  const attempts: string[] = [];
  const rpc: CatalogRpc = async (name, _args, signal) => {
    assert.equal(signal, controller.signal);
    attempts.push(name);
    if (name === 'lite1_catalog_page2') controller.abort();
    return { data: null, status: 404, error: { code: 'PGRST202', message: name } };
  };
  await assert.rejects(
    readCatalog225(rpc, 'public_storefront_catalog_page225', undefined,
      () => readOperatingCatalog(rpc, 'lite1_catalog_page2', undefined, controller.signal),
      controller.signal),
    { name: 'AbortError' },
  );
  assert.deepEqual(attempts, ['public_storefront_catalog_page225', 'lite1_catalog_page2']);
});
