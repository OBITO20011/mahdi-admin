import {access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as poll} from 'node:timers/promises';

export async function stopIsolatedVite(port) {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/__isolated_vite_shutdown`, {
      method: 'POST', signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return;
    throw error;
  }
  // A pre-existing ordinary dev server has no test shutdown endpoint: leave it alone.
  if (response.status === 404) return;
  if (!response.ok) throw new Error('ISOLATED_VITE_SHUTDOWN_FAILED');
  const {ownedDirectory} = await response.json();
  const resolved = path.resolve(ownedDirectory);
  if (path.dirname(resolved) !== path.resolve(tmpdir())
    || !path.basename(resolved).startsWith(`nawasrah-vite-${port}-`)) {
    throw new Error('INVALID_VITE_CACHE_SHUTDOWN_PROOF');
  }
  // Poll actual deletion, not a fixed sleep. This never deletes a directory itself.
  const deadline = Date.now() + 5000;
  while (await access(resolved).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  })) {
    if (Date.now() >= deadline) throw new Error('ISOLATED_VITE_CACHE_NOT_REMOVED');
    await poll(20);
  }
}
