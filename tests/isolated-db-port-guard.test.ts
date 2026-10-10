import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {createConnection, createServer, type Socket} from 'node:net';
import test from 'node:test';
import {databasePortsFromConfig, describePortHolders, probeTcpPort, readLinuxEphemeralPortRange, waitForDatabasePorts}
  from '../scripts/testing/isolated-db-port-guard.mjs';
import {isolatedSupabasePortSettings, withIsolatedSupabasePorts}
  from '../scripts/testing/isolated-supabase-ports.mjs';

test('isolated config explicitly assigns unique ports below both standard ephemeral ranges,without changing source', () => {
  const source=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
  const isolated=withIsolatedSupabasePorts(source);
  assert.equal(withIsolatedSupabasePorts(isolated),isolated,'Config transformation must be idempotent');
  assert.equal(readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8'),source);
  const ports=isolatedSupabasePortSettings.map(({port})=>port);
  assert.equal(new Set(ports).size,ports.length);
  for(const setting of isolatedSupabasePortSettings) {
    assert.ok(setting.port>=1024&&setting.port<32768);
    if(setting.optional)continue;
    const section=isolated.split(`[${setting.section}]`)[1]?.split(/\n\s*\[/u)[0];
    assert.ok(section);assert.match(section,new RegExp(`^${setting.key} = ${setting.port}$`,'mu'));
  }
  assert.deepEqual(databasePortsFromConfig(isolated),[25432,25430]);
  assert.doesNotMatch(isolated,/^\s*(?:smtp_port|pop3_port)\s*=/mu,'Do not enable optional SMTP listeners');
  const customized=withIsolatedSupabasePorts('[api]\nport = 50000\nmax_rows = 432\n[db]\nport = 50001\nshadow_port = 50002\n[local_smtp]\nsmtp_port = 50003\n');
  assert.match(customized,/max_rows = 432/u);assert.match(customized,/smtp_port = 25435/u);
  assert.doesNotMatch(customized,/5000[0-3]/u);
  assert.throws(()=>withIsolatedSupabasePorts('[db]\nport=1\nport=2'),/DUPLICATE_ISOLATED_PORT_KEY/u);
  assert.throws(()=>withIsolatedSupabasePorts('[db]\nport=1\n[db]\nport=2'),/DUPLICATE_ISOLATED_PORT_SECTION/u);
});

test('actual outbound TCP source socket blocks bind without being a listening server', async context => {
  let accepted:Socket|undefined;
  const server=createServer(socket=>{accepted=socket;});
  await new Promise<void>(resolve=>server.listen({host:'127.0.0.1',port:0},resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const client=createConnection({host:'127.0.0.1',port:address.port});
  try {
    await new Promise<void>((resolve,reject)=>{client.once('connect',resolve);client.once('error',reject);});
    assert.ok(client.localPort);assert.notEqual(client.localPort,address.port);
    assert.equal(await probeTcpPort(client.localPort),false,'Established outbound source port is not available for DB bind');
    assert.equal(client.destroyed,false,'Guard cannot terminate outbound owner');
    const range=await readLinuxEphemeralPortRange();
    if('first' in range)assert.ok(client.localPort>=range.first&&client.localPort<=range.last);
    context.diagnostic(JSON.stringify({sourcePort:client.localPort,listenerPort:address.port,ephemeralPortRange:range}));
  } finally {
    client.destroy();accepted?.destroy();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});

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

test('holder diagnostics inspect docker publishing and all TCP states; unavailable ss remains explicit', async () => {
  const calls:string[][]=[];
  const result=await describePortHolders([54322],async(command:string,args:string[])=>{
    calls.push([command,...args]);
    if(command==='ss')throw Object.assign(Error('missing'),{code:'ENOENT'});
    return {stdout:'abc\tsupabase_db_test\t0.0.0.0:54322->5432/tcp'};
  });
  assert.deepEqual(calls,[['docker','ps','--filter','publish=54322','--format','{{.ID}}\t{{.Names}}\t{{.Ports}}'],['ss','-tanp']]);
  assert.match(result[0].docker,/supabase_db_test/u);assert.match(result[0].ss,/ENOENT/u);
});

test('ss reports local outbound/TIME-WAIT/IPv6 ownership;peer port alone cannot impersonate owner', async () => {
  const result=await describePortHolders([54322],async(command:string)=>({stdout:command==='docker'?'':
    'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n'
    +'ESTAB 0 0 127.0.0.1:54322 127.0.0.1:25431 users:(("outbound-owner",pid=12,fd=3))\n'
    +'TIME-WAIT 0 0 127.0.0.1:54322 127.0.0.1:25431\n'
    +'ESTAB 0 0 [::1]:54322 [::1]:25431 users:(("ipv6-owner",pid=13,fd=4))\n'
    +'ESTAB 0 0 127.0.0.1:54321 127.0.0.1:54322 users:(("peer-only",pid=14,fd=5))'}));
  assert.match(result[0].ss,/outbound-owner/u);assert.match(result[0].ss,/TIME-WAIT/u);
  assert.match(result[0].ss,/ipv6-owner/u);assert.doesNotMatch(result[0].ss,/peer-only|54321/u);
  assert.ok(result[0].ephemeralPortRange.source.endsWith('ip_local_port_range'));
});

test('ephemeral range comes from the actual Linux sysctl,not a guessed constant', async () => {
  assert.deepEqual(await readLinuxEphemeralPortRange(async file=>{
    assert.equal(file,'/proc/sys/net/ipv4/ip_local_port_range');return '32768\t60999\n';
  }),{source:'/proc/sys/net/ipv4/ip_local_port_range',first:32768,last:60999});
  assert.ok('unavailable' in await readLinuxEphemeralPortRange(async()=> 'invalid'));
});

test('runtime callers do not pin old host ports instead of CLI/bootstrap-derived endpoints', () => {
  const directory=new URL('../scripts/testing/',import.meta.url);
  for(const file of readdirSync(directory).filter(file=>file.endsWith('.mjs'))) {
    const source=readFileSync(new URL(file,directory),'utf8');
    assert.doesNotMatch(source,/(?:localhost|127\.0\.0\.1|\[::1\]):5432[012]\b/u,file);
  }
});

test('bootstrap checks actual DB bind before start and preserves existing deadlines/ownership guard', () => {
  const source=readFileSync(new URL('../scripts/testing/bootstrap-isolated-supabase.mjs',import.meta.url),'utf8');
  assert.ok(source.indexOf('await waitForDatabasePorts(')<source.indexOf("const startArguments = [cliPath, 'start'"));
  assert.match(source,/ISOLATED_TEST_STACK_ACTIVE/u);assert.match(source,/timeout: 240_000/u);assert.match(source,/timeout: 180_000/u);
  assert.ok(source.includes('dbPortGuard,'));
  assert.ok(source.includes('withIsolatedSupabasePorts(sourceConfig.replace('));
  assert.ok(source.includes('ISOLATED_PORT_IN_EPHEMERAL_RANGE'));
  const helper=readFileSync(new URL('../scripts/testing/isolated-db-port-guard.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(helper,/\.kill\(|['"]docker['"],\s*\[\s*['"](?:stop|rm)['"]|kill -/u);
});
