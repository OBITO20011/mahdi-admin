import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import {assertPrivateMapPath, privateMapsEnabled, privateSourceMaps} from '../scripts/environments/private-source-maps.mjs';
import {symbolicateLocal} from '../scripts/monitoring/symbolicate-local.mjs';
import {assertNoPublishedMaps} from '../scripts/environments/verify-dist.mjs';
import {sanitizeEvent} from '../src/lib/monitoringPrivacy';
import {privateMapPins,sourceBeforePrivateMaps} from '../scripts/audit/source-before-private-maps.mjs';
import {sourceBeforeMobileBack} from '../scripts/audit/source-before-mobile-back.mjs';
import {resolveBuildEnvironment} from '../scripts/environments/environment.mjs';
import {sourceBeforeWorkbookIntegration} from '../scripts/audit/source-before-workbook-integration.mjs';

const release='1111111111111111111111111111111111111111';
test('hidden maps leave no publishable file/reference, are protected by release, and symbolicate the existing Sentry frame locally', async () => {
 const scratch=await mkdtemp(path.join(os.tmpdir(),'nawasrah-private-map-test-'));
 const root=path.join(scratch,'app'),archive=path.join(scratch,'private');
 await mkdir(root);await writeFile(path.join(root,'index.html'),'<script type="module" src="/fixture.ts"></script>');
 await writeFile(path.join(root,'fixture.ts'),'function fixtureFailure(){\nthrow new TypeError("SYNTHETIC_FAILURE");\n}\nfixtureFailure();\n');
 const previous=process.env.NAWASRAH_PRIVATE_SOURCE_MAPS_DIR;process.env.NAWASRAH_PRIVATE_SOURCE_MAPS_DIR=archive;
 try {
  const selected=resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:'production'});selected.monitoring.release=release;
  await build({configFile:false,root,logLevel:'silent',plugins:[privateSourceMaps(selected,root,'admin')]});
  const assets=await readdir(path.join(root,'dist/assets'));
  assert.ok(assets.length>0);assert.ok(assets.every(file=>!file.endsWith('.map')));
  for(const file of assets)await assertNoPublishedMaps(file,await readFile(path.join(root,'dist/assets',file),'utf8'));
  const parent=path.join(archive,'admin',release,'production');const runs=await readdir(parent);assert.equal(runs.length,1);
  const dir=path.join(parent,runs[0]),manifest=path.join(dir,'manifest.json');
  if(process.platform!=='win32')assert.equal((await stat(dir)).mode&0o777,0o700);
  const saved=JSON.parse(await readFile(manifest,'utf8'));assert.equal(saved.release,release);assert.equal(saved.entries.length,1);
  const entry=saved.entries[0],code=await readFile(path.join(root,'dist',entry.file),'utf8');
  const offset=code.indexOf('SYNTHETIC_FAILURE');assert.ok(offset>0);
  const prefix=code.slice(0,offset),lineno=prefix.split('\n').length,colno=prefix.length-prefix.lastIndexOf('\n');
  const safe=sanitizeEvent({type:undefined,message:'اسم سري 0771234567 100.500',user:{email:'private@example.test'},extra:{cart:['private'],token:'private'},exception:{values:[{type:'TypeError',value:'private',stacktrace:{frames:[{filename:'https://admin.example.test/'+entry.file+'?token=private',lineno,colno,vars:{phone:'private'},context_line:'private'}]}}]}},{origin:'https://admin.example.test',screen:'pos'});
  const frame=safe.exception!.values![0].stacktrace!.frames![0];
  const result=await symbolicateLocal({manifest,release,filename:frame.filename,lineno:frame.lineno,colno:frame.colno});
  assert.match(result.source,/fixture\.ts$/u);assert.equal(result.line,2);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_FAILURE'),'No source text returned');
  const cli=JSON.parse(execFileSync(process.execPath,['scripts/monitoring/symbolicate-local.mjs','--manifest',manifest,'--release',release,'--filename',frame.filename!,'--line',String(frame.lineno),'--column',String(frame.colno)],{encoding:'utf8',windowsHide:true}));
  assert.deepEqual(cli,result,'The exact existing sanitized filename/lineno/colno is sufficient');
  await build({configFile:false,root,logLevel:'silent',build:{outDir:'control-dist',sourcemap:false}});
  assert.equal(await readFile(path.join(root,'control-dist',entry.file),'utf8'),code,'Enabling private maps preserves the executable JavaScript bytes');
  await assert.rejects(()=>symbolicateLocal({manifest,release:'2'.repeat(40),filename:'https://admin.example.test/'+entry.file,lineno,colno}),/SYMBOLICATE_RELEASE_MISMATCH/u);
  await writeFile(path.join(dir,entry.map),'{}');
  await assert.rejects(()=>symbolicateLocal({manifest,release,filename:'https://admin.example.test/'+entry.file,lineno,colno}),/SYMBOLICATE_MAP_HASH_MISMATCH/u);
 }finally{if(previous===undefined)delete process.env.NAWASRAH_PRIVATE_SOURCE_MAPS_DIR;else process.env.NAWASRAH_PRIVATE_SOURCE_MAPS_DIR=previous;await rm(scratch,{recursive:true,force:true});}
});

test('dist rejects map files, compressed maps, inline/external mapping comments and allows ordinary JavaScript',()=>{
 for(const file of ['assets/main.js.map','assets/main.js.MAP','assets/main.js.map.gz'])assert.throws(()=>assertNoPublishedMaps(file,'{}'),/DIST_PRIVATE_SOURCE_MAP_FORBIDDEN/u);
 for(const text of ['//# sourceMappingURL=main.js.map','/*# sourceMappingURL=main.css.map */','//@ sourceMappingURL=data:application/json;base64,e30='])assert.throws(()=>assertNoPublishedMaps('assets/main.js',text),/DIST_SOURCE_MAP_REFERENCE_FORBIDDEN/u);
 assert.doesNotThrow(()=>assertNoPublishedMaps('assets/main.js','console.log("fixture")'));
});

test('maps only production/trial; archive cannot be inside Git or dist',()=>{
 for(const environment of ['production','prelaunch-trial','staging'])assert.equal(privateMapsEnabled(resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:environment})),environment!=='staging');
 assert.equal(privateMapsEnabled(resolveBuildEnvironment({VITE_BROWSER_QA_ISOLATED:'true',VITE_SUPABASE_URL:'http://127.0.0.1:54321',VITE_SUPABASE_ANON_KEY:'isolated-private-maps-test-key'})),false);
 assert.throws(()=>assertPrivateMapPath(path.resolve('dist/maps'),path.resolve('dist')),/PRIVATE_MAPS_PATH_INSIDE_DIST/u);
 assert.throws(()=>assertPrivateMapPath(path.resolve('maps'),path.resolve('dist')),/PRIVATE_MAPS_PATH_INSIDE_GIT/u);
});

test('map projection preserves actual baseline bytes and every protected owner helper;unknown mutations remain visible',async()=>{
 const baseline='8198f6ca301a73a84067af8909744a957508fc3c';
 for(const[file,pin]of Object.entries(privateMapPins)as[string,{beforeText:string;after:string}][]){
  const raw=sourceBeforeMobileBack(file,sourceBeforeWorkbookIntegration(file,await readFile(file,'utf8')))!.replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(raw).digest('hex'),pin.after);
  assert.equal(pin.beforeText,execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n'));
  assert.equal(sourceBeforePrivateMaps(file,raw),pin.beforeText);
  assert.equal(sourceBeforePrivateMaps(file,raw+'\nunknown\n'),raw+'\nunknown\n');
 }
 const protectedFiles=JSON.parse(await readFile('scripts/testing/rehearsal219-owner-source-pins.json','utf8')).files.map((entry:[string,string])=>entry[0]);
 const changed=execFileSync('git',['diff','--name-only',baseline,'--',...protectedFiles],{encoding:'utf8',windowsHide:true}).trim().split('\n').filter(Boolean);
 for(const file of changed)assert.equal(sourceBeforeMobileBack(file,sourceBeforeWorkbookIntegration(file,await readFile(file,'utf8'))),execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true}),file);
});
