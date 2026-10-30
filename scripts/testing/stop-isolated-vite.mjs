import {access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as poll} from 'node:timers/promises';

// Windows can briefly return EPERM while another process finishes deleting a
// directory. This is never proof of deletion: require ENOENT within the same5s.
/** @param {string} resolved
 * @param {{probe?:(directory:string)=>Promise<void>,platform?:NodeJS.Platform,clock?:()=>number,pause?:(milliseconds:number)=>Promise<void>}} [options] */
export async function waitForOwnedViteRemoval(resolved,{
  probe=access,platform=process.platform,clock=Date.now,pause=poll,
}={}) {
  const deadline=clock()+5000;
  for(;;){
    try{await probe(resolved);}catch(error){
      if(error.code==='ENOENT')return;
      if(platform!=='win32'||error.code!=='EPERM')throw error;
    }
    if(clock()>=deadline)throw new Error('ISOLATED_VITE_CACHE_NOT_REMOVED');
    await pause(20);
  }
}

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
  await waitForOwnedViteRemoval(resolved);
}
