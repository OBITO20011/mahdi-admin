import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:net';
import test from 'node:test';
import {databasePortsFromConfig, describePortHolders, probeTcpPort, waitForDatabasePorts}
  from '../scripts/testing/isolated-db-port-guard.mjs';

test('DB ports come from the actual db section,not unrelated service ports', () => {
  assert.deepEqual(databasePortsFromConfig('[api]\nport = 1234'), [54322,54320]);
  assert.deepEqual(databasePortsFromConfig('[db]\nport = 25432 # local\nshadow_port = 25433\n[api]\nport = 1234'), [25432,25433]);
  for (const config of ['[db]\nport = 0','[db]\nport = "54322"','[db]\nport = 54320'])
    assert.throws(() => databasePortsFromConfig(config));
});

test('actual bind detects an occupied socket and never closes its owner', async () => {
  const server=createServer();
  await new Promise<void>(resolve=>server.listen({host:'127.0.0.1',port:0,exclusive:true},resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  try {
    assert.equal(await probeTcpPort(address.port),false);
    await assert.rejects(waitForDatabasePorts([address.port],{timeoutMs:0,holders:async ports=>ports.map(port=>({port,owner:'unit listener'}))}),
      error=>{assert.match(String(error),/PORT_STILL_BOUND.*unit listener/u);return true;});
    assert.equal(server.listening,true,'Guard cannot kill/release a foreign listener');
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  assert.equal(await probeTcpPort(address.port),true);
});

test('release is condition-polled with a real bind,without a fixed startup sleep', async () => {
  const server=createServer();
  await new Promise<void>(resolve=>server.listen({host:'127.0.0.1',port:0,exclusive:true},resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  let clock=0,pauses=0;
  try {
    const result=await waitForDatabasePorts([address.port],{timeoutMs:60,pollMs:5,now:()=>clock,pause:async ms=>{
      clock+=ms;pauses+=1;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }});
    assert.equal(pauses,1);assert.equal(result.probes,2);assert.equal(result.releaseWaitMs,5);
    assert.equal(result.waitedForRelease,true);
  } finally {if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('IPv6 loopback listener also prevents a false free-port result', async context => {
  const server=createServer();
  try {
    await new Promise<void>((resolve,reject)=>{
      server.once('error',reject);server.listen({host:'::1',port:0,exclusive:true,ipv6Only:true},resolve);
    });
  } catch(error) {
    if(['EAFNOSUPPORT','EADDRNOTAVAIL'].includes((error as NodeJS.ErrnoException).code||'')) {
      context.skip('Host has no IPv6 loopback');return;
    }
    throw error;
  }
  const address=server.address();assert.ok(address&&typeof address!=='string');
  try {assert.equal(await probeTcpPort(address.port),false);assert.equal(server.listening,true);}
  finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('every DB port must be free on the final probe and wait is bounded', async () => {
  let clock=0,diagnostics=0;
  await assert.rejects(waitForDatabasePorts([54322,54320],{timeoutMs:11,pollMs:5,now:()=>clock,
    probe:async port=>port===54322,pause:async ms=>{clock+=ms;},holders:async ports=>{
      diagnostics+=1;assert.deepEqual(ports,[54320]);return [{port:54320,owner:'still bound'}];
    }}),/PORT_STILL_BOUND/u);
  assert.equal(clock,11);assert.equal(diagnostics,1);
  const free=await waitForDatabasePorts([54322],{probe:async()=>true,pause:async()=>assert.fail('No delay on a free port')});
  assert.equal(free.releaseWaitMs,0);assert.equal(free.waitedForRelease,false);
  await assert.rejects(waitForDatabasePorts([54322],{timeoutMs:60001}),/INVALID_PORT_WAIT_BOUND/u);
  await assert.rejects(waitForDatabasePorts([54322],{probe:async()=>{throw Error('probe failed');}}),/probe failed/u);
});

test('holder diagnostics inspect docker publishing and ss only; unavailable ss remains explicit', async () => {
  const calls:string[][]=[];
  const result=await describePortHolders([54322],async(command:string,args:string[])=>{
    calls.push([command,...args]);
    if(command==='ss')throw Object.assign(Error('missing'),{code:'ENOENT'});
    return {stdout:'abc\tsupabase_db_test\t0.0.0.0:54322->5432/tcp'};
  });
  assert.deepEqual(calls,[['docker','ps','--filter','publish=54322','--format','{{.ID}}\t{{.Names}}\t{{.Ports}}'],['ss','-ltnp']]);
  assert.match(result[0].docker,/supabase_db_test/u);assert.match(result[0].ss,/ENOENT/u);
});

test('available ss reports only the requested listener identity,not unrelated sockets', async () => {
  const result=await describePortHolders([54322],async(command:string)=>({stdout:command==='docker'?'':
    'LISTEN 0 511 127.0.0.1:54322 0.0.0.0:* users:(("db-holder",pid=12,fd=3))\nLISTEN 0 511 127.0.0.1:54321 0.0.0.0:*'}));
  assert.match(result[0].ss,/db-holder/u);assert.doesNotMatch(result[0].ss,/54321/u);
});

test('bootstrap checks actual DB bind before start and preserves existing deadlines/ownership guard', () => {
  const source=readFileSync(new URL('../scripts/testing/bootstrap-isolated-supabase.mjs',import.meta.url),'utf8');
  assert.ok(source.indexOf('await waitForDatabasePorts(')<source.indexOf("const startArguments = [cliPath, 'start'"));
  assert.match(source,/ISOLATED_TEST_STACK_ACTIVE/u);assert.match(source,/timeout: 240_000/u);assert.match(source,/timeout: 180_000/u);
  assert.ok(source.includes('dbPortGuard,'));
  const helper=readFileSync(new URL('../scripts/testing/isolated-db-port-guard.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(helper,/\.kill\(|['"]docker['"],\s*\[\s*['"](?:stop|rm)['"]|kill -/u);
});
