import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {executeInput} from '../operations/build-empty-supabase.mjs';

export function raceAftercare215(c) {
  const {sql} = c;
  const held = async call => {
    const child = spawn('docker', ['exec', '-i', 'supabase_db_nawasrah-tb215-test', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '', stderr = '', readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(stdout) : reject(Error(stderr)));
    });
    void done.catch(error => readyReject(error));
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('TB215_HOLDER_READY')) readyResolve(); });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.write(c.auth(`SELECT public.${call};`).replace('COMMIT;', "SELECT 'TB215_HOLDER_READY';") + '\n');
    await ready;
    return async () => { child.stdin.end('COMMIT;\n'); await done; };
  };
  const race = async (first, second) => {
    const release = await held(first);
    let contender;
    try {
      contender = executeInput(c.executor, "SET application_name='tb215-contender';" + c.auth(`SELECT public.${second};`));
      let blocked = false;
      for (let n = 0; n < 100; n++) {
        if (await sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='tb215-contender' AND cardinality(pg_blocking_pids(pid))>0;") === '1') { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(blocked, true, 'INDEPENDENT_POSTGRES_SESSION_MUST_BLOCK');
    } finally { await release(); }
    return contender;
  };
  return race;
}
