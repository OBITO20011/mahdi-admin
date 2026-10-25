// Loopback-only STARTTLS session proxy and real libpq tools. Never reads owner
// configuration. The disposable server certificate/key are generated in TEMP.
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,mkdir,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {SnapshotSession} from '../backup/snapshot-session.mjs';
import {IMAGE,createCompleteBackup,restoreCompleteBackup} from '../backup/complete-backup.mjs';
import {SUPABASE_CA_PATH} from '../backup/supabase-ca.mjs';
import {postgresDiagnostic,diagnosticError} from '../backup/postgres-diagnostic.mjs';
const exec=promisify(execFile);
const pgArgs=['-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
export async function nativeBackupTlsProbe({container,output}){
  assert.equal(container,'supabase_db_nawasrah-dual-backup-test');
  const work=await mkdtemp(path.join(tmpdir(),'nawasrah-native-tls-')),clients=new Set(),sockets=new Set();
  const password=randomBytes(24).toString('hex');
  const env={...process.env,PGPASSWORD:password,PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=600000',LC_ALL:'C'};
  let server,admin,exporter;
  const docker=async args=>exec('docker',args,{windowsHide:true,timeout:600000,maxBuffer:8*1024**2});
  try{
    const openssl=process.platform==='win32'?path.join(process.env.ProgramFiles,'Git','usr','bin','openssl.exe'):'openssl';
    const ssl=async args=>exec(openssl,args,{windowsHide:true,timeout:30000,maxBuffer:2**20});
    await ssl(['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(work,'ca.key'),'-out',path.join(work,'root.crt'),'-days','2','-subj','/CN=Nawasrah isolated TLS fixture CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);
    await ssl(['req','-newkey','rsa:2048','-nodes','-keyout',path.join(work,'server.key'),'-out',path.join(work,'server.csr'),'-subj','/CN=localhost']);
    const extensions=path.join(work,'extensions.cnf');await writeFile(extensions,'subjectAltName=DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
    await ssl(['x509','-req','-in',path.join(work,'server.csr'),'-CA',path.join(work,'root.crt'),'-CAkey',path.join(work,'ca.key'),'-CAcreateserial','-out',path.join(work,'server.crt'),'-days','2','-extfile',extensions]);
    await writeFile(path.join(work,'wrong.crt'),await readFile(SUPABASE_CA_PATH));
    const backendPortOutput=(await docker(['port',container,'5432/tcp'])).stdout;
    const backendPort=Number(backendPortOutput.match(/(?:127\.0\.0\.1|0\.0\.0\.0):(\d+)/u)?.[1]);assert.ok(backendPort>0&&backendPort<65536);
    const context=tls.createSecureContext({key:await readFile(path.join(work,'server.key')),cert:await readFile(path.join(work,'server.crt')),minVersion:'TLSv1.2'});
    server=net.createServer(socket=>{
      sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
      socket.once('data',packet=>{
        if(packet.length!==8||packet.readUInt32BE(0)!==8||packet.readUInt32BE(4)!==80877103){socket.destroy();return;}
        socket.write('S');
        const secure=new tls.TLSSocket(socket,{isServer:true,secureContext:context});
        const upstream=net.connect({host:'127.0.0.1',port:backendPort});sockets.add(upstream);
        upstream.on('close',()=>{sockets.delete(upstream);secure.destroy();});secure.on('close',()=>upstream.destroy());
        secure.on('error',()=>upstream.destroy());upstream.on('error',()=>secure.destroy());secure.pipe(upstream).pipe(secure);
      });
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const port=server.address().port;
    const isWindows=process.platform==='win32';
    const pgBin=path.join(process.env.LOCALAPPDATA??'','NawasrahBackup','postgresql-17.11','bin');
    if(isWindows)for(const tool of ['psql','pg_dump','pg_dumpall'])await access(path.join(pgBin,tool+'.exe'));
    let serial=0;
    const invocation=(tool,args)=>{
      if(isWindows)return {command:path.join(pgBin,tool+'.exe'),args};
      const name='nawasrah-native-tls-client-'+process.pid+'-'+(++serial);clients.add(name);
      return {command:'docker',args:['run','--rm','-i','--network','host','--name',name,'--user',process.getuid()+':'+process.getgid(),'--env','HOME=/tmp','--env','PGPASSWORD','--env','PGOPTIONS','--env','LC_ALL','--volume',work+':/tls','--entrypoint',tool,IMAGE,...args]};
    };
    const uri=({host='localhost',ca='root.crt'}={})=>{
      const url=new URL(`postgresql://postgres@${host}:${port}/postgres`);
      url.searchParams.set('hostaddr','127.0.0.1');url.searchParams.set('sslmode','verify-full');url.searchParams.set('sslrootcert',ca==='system'?'system':isWindows?path.join(work,ca):'/tls/'+ca);
      url.searchParams.set('gssencmode','disable');url.searchParams.set('connect_timeout','5');
      assert.equal(url.searchParams.get('hostaddr'),'127.0.0.1');assert.ok(['localhost','wrong.invalid'].includes(url.hostname));return url.href;
    };
    const open=(url)=>{const call=invocation('psql',[...pgArgs,'--dbname',url]);return new SnapshotSession(call.command,call.args,env);};
    const execute=async(tool,args,stage)=>{const call=invocation(tool,args);try{return await exec(call.command,call.args,{env,windowsHide:true,timeout:600000,maxBuffer:8*1024**2});}
      catch(error){throw diagnosticError('LOCAL_NATIVE_TOOL_FAILED',postgresDiagnostic(error,{tool,stage}));}};
    const version=(await execute('psql',['--version'],'snapshot')).stdout.trim();assert.match(version,/PostgreSQL\)? 17\./u);if(isWindows)assert.match(version,/17\.11/u);
    admin=new SnapshotSession('docker',['exec','-i',container,'psql','-U','supabase_admin','-d','postgres',...pgArgs]);
    await admin.query(`ALTER ROLE postgres PASSWORD '${password}';CREATE TABLE public.backup_tls_snapshot_probe(id integer PRIMARY KEY);INSERT INTO public.backup_tls_snapshot_probe VALUES(1);`);
    const rejected=[];
    for(const [name,url,category]of [
      ['system-trust',uri({ca:'system'}),'TLS_CA_UNTRUSTED'],
      ['wrong-ca',uri({ca:'wrong.crt'}),'TLS_CA_UNTRUSTED'],
      ['wrong-hostname',uri({host:'wrong.invalid'}),'TLS_HOSTNAME_MISMATCH'],
    ]){
      const session=open(url);try{await assert.rejects(session.query('BEGIN READ ONLY;'),error=>{
        assert.equal(error.diagnostic.category,category,name);assert.ok(!JSON.stringify(error).includes(password));rejected.push({name,category:error.diagnostic.category,exitCode:error.diagnostic.exitCode});return true;
      });}finally{await session.close();}
    }
    // Positive: explicit CA + hostname validation, read-only and real exported
    // snapshot across separate psql/pg_dump connections through the session proxy.
    exporter=open(uri());await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');
    assert.equal((await exporter.query('SHOW transaction_read_only;')).trim(),'on');assert.equal((await exporter.query('SHOW transaction_isolation;')).trim(),'repeatable read');
    const snapshot=(await exporter.query('SELECT pg_export_snapshot();')).trim();assert.match(snapshot,/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/u);
    await admin.query('INSERT INTO public.backup_tls_snapshot_probe VALUES(2);');
    const snapshotFile=isWindows?path.join(work,'snapshot.sql'):'/tls/snapshot.sql';
    await execute('pg_dump',['--data-only','--table=public.backup_tls_snapshot_probe','--snapshot='+snapshot,'--file='+snapshotFile,uri()],'complete-dump');
    const contents=await readFile(path.join(work,'snapshot.sql'),'utf8');assert.match(contents,/COPY public\.backup_tls_snapshot_probe[^]*?\n1\r?\n\\\./u);assert.doesNotMatch(contents,/\n2\r?\n/u);
    await exporter.close();exporter=null;
    const readonly=open(uri());try{await readonly.query('BEGIN READ ONLY;');await assert.rejects(readonly.query('INSERT INTO public.backup_tls_snapshot_probe VALUES(3);'),error=>{assert.equal(error.diagnostic.sqlstate,'25006');assert.equal(error.diagnostic.category,'SQL_READ_ONLY_VIOLATION');return true;});}finally{await readonly.close();}
    await admin.query('DROP TABLE public.backup_tls_snapshot_probe;');
    const source={session:()=>open(uri()),readObject:async name=>{assert.equal(name,'test/photo.png');return Buffer.from('image123');},
      dump:async(snap,destination)=>{const file=isWindows?destination:'/tls/complete.dump';await execute('pg_dump',['-Fc','--no-password','--snapshot='+snap,'--file='+file,uri()],'complete-dump');if(!isWindows)await writeFile(destination,await readFile(path.join(work,'complete.dump')));},
      roles:async destination=>{const file=isWindows?destination:'/tls/roles.sql';await execute('pg_dumpall',['--roles-only','--no-role-passwords','--no-tablespaces','--file='+file,'--database='+uri()],'roles-dump');if(!isWindows)await writeFile(destination,await readFile(path.join(work,'roles.sql')));}};
    const archiveRoot=path.join(work,'Frankfurt-kzevmysfydaslxcerogt');await mkdir(archiveRoot);
    const backup=await createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:archiveRoot,passphrase:password,source});
    const restored=await restoreCompleteBackup({archivePath:backup.archivePath,passphrase:password,reportPath:path.join(output,'native-tls-restore.json')});assert.equal(restored.ok,true);
    const proof={ok:true,hostedConnectionsMade:false,transport:'localhost-only-PostgreSQL-STARTTLS-session-proxy',client:version,clientMode:isWindows?'Windows native17.11':'isolated Docker native17',sslmode:'verify-full',explicitRootAccepted:true,hostnameVerified:true,ipv4Loopback:true,readOnlyViolationSqlstate:'25006',snapshotCrossConnectionConsistent:true,systemStoreInsufficientReproduced:true,rejected,fullNativeBackupRestore:true,tablesCompared:restored.tablesCompared,integrityChecks:restored.integrityChecks.length,ownerConfigurationRead:false};
    await writeFile(path.join(output,'native-tls-proof.json'),JSON.stringify(proof,null,2)+'\n');return proof;
  }finally{
    await exporter?.close().catch(()=>{});await admin?.close().catch(()=>{});
    for(const socket of sockets)socket.destroy();if(server)await new Promise(resolve=>server.close(resolve));
    for(const name of clients)await docker(['rm','--force',name]).catch(()=>{});
    assert.equal(path.dirname(path.resolve(work)),path.resolve(tmpdir()));assert.ok(path.basename(work).startsWith('nawasrah-native-tls-'));await rm(work,{recursive:true,force:true});
  }
}
