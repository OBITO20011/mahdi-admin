import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {gunzipSync} from 'node:zlib';import path from 'node:path';
import {pinnedPostgrest as pin,assertPinnedPostgrestArchive,assertPinnedPostgrestImage,loadPinnedPostgrestImage} from '../scripts/testing/pinned-postgrest-image.mjs';
const archive=path.resolve(pin.archive),sha=(b:Buffer|string)=>'sha256:'+createHash('sha256').update(b).digest('hex');
const blob=(digest:string)=>execFileSync('tar',['-xOf',archive,'blobs/sha256/'+digest.slice(7)],{maxBuffer:32*1024**2});
interface ImageInfo {Id:string;Os:string;Architecture:string;RootFS:{Type:string;Layers:string[]};Config:{User:string;Cmd:string[];Env:string[];Entrypoint:string[]|null}}
const good=():ImageInfo=>({Id:pin.configDigest,Os:'linux',Architecture:'amd64',RootFS:{Type:'layers',Layers:[pin.rootLayer]},Config:{User:'1000',Cmd:['/bin/postgrest'],Env:[],Entrypoint:null}});

test('bundled QA image cryptographically matches the prior official multiarch manifest,config and filesystem',()=>{
 const bytes=readFileSync(archive);assertPinnedPostgrestArchive(bytes);
 const upstream=JSON.parse(readFileSync('tests/fixtures/postgrest-v16.1-registry-manifest.json','utf8'));
 assert.equal(pin.indexDigest,upstream.digest);assert.equal(sha(upstream.manifestText),pin.indexDigest);
 const indexBytes=blob(pin.indexDigest);assert.equal(sha(indexBytes),pin.indexDigest);assert.deepEqual(JSON.parse(indexBytes.toString()),JSON.parse(upstream.manifestText));
 const index=JSON.parse(indexBytes.toString()),amd64=index.manifests.find((m:{platform:{os:string;architecture:string}})=>m.platform.os==='linux'&&m.platform.architecture==='amd64');assert.equal(amd64.digest,pin.amd64Manifest);
 const manifestBytes=blob(amd64.digest);assert.equal(sha(manifestBytes),pin.amd64Manifest);const manifest=JSON.parse(manifestBytes.toString());assert.equal(manifest.config.digest,pin.configDigest);assert.deepEqual(manifest.layers.map((l:{digest:string})=>l.digest),[pin.layerDigest]);
 const configBytes=blob(pin.configDigest);assert.equal(sha(configBytes),pin.configDigest);const config=JSON.parse(configBytes.toString());assert.equal(config.os,'linux');assert.equal(config.architecture,'amd64');assert.deepEqual(config.rootfs.diff_ids,[pin.rootLayer]);
 const layer=blob(pin.layerDigest);assert.equal(sha(layer),pin.layerDigest);assert.equal(sha(gunzipSync(layer)),pin.rootLayer);
});

test('bundled image rejects modified archive,image identity,platform,filesystem,user or startup command',()=>{
 const original=readFileSync(archive),corrupt=Buffer.from(original);corrupt[Math.floor(corrupt.length/2)]^=1;assert.throws(()=>assertPinnedPostgrestArchive(corrupt),/ARCHIVE_SHA256/);
 assert.equal(assertPinnedPostgrestImage(good()),pin.configDigest);assert.equal(assertPinnedPostgrestImage({...good(),Id:pin.indexDigest}),pin.indexDigest);
 for(const change of ['id','os','arch','layer','user','cmd','env','entrypoint']){const value=good();if(change==='id')value.Id='sha256:'+'0'.repeat(64);if(change==='os')value.Os='windows';if(change==='arch')value.Architecture='arm64';if(change==='layer')value.RootFS.Layers=['sha256:'+'0'.repeat(64)];if(change==='user')value.Config.User='0';if(change==='cmd')value.Config.Cmd=['/bin/sh'];if(change==='env')value.Config.Env=['EXTRA=1'];if(change==='entrypoint')value.Config.Entrypoint=['/bin/sh'];assert.throws(()=>assertPinnedPostgrestImage(value),/PINNED_POSTGREST/,change);}
});

test('QA loader uses only local archive and immutable image ID with an offline exact-version probe',async()=>{
 const calls:{command:string;args:string[]}[]=[];const execute=async(command:string,args:string[])=>{calls.push({command,args});return {stdout:args[0]==='image'&&args[1]==='inspect'?JSON.stringify([good()]):args[0]==='run'?'PostgREST 16.1\n':'Loaded image',stderr:''};};
 const result=await loadPinnedPostgrestImage({execute});assert.equal(result,pin.configDigest);assert.deepEqual(calls,[{command:'docker',args:['image','load','--input',archive]},{command:'docker',args:['image','inspect',pin.tag]},{command:'docker',args:['run','--rm','--network=none','--entrypoint','/bin/postgrest',pin.configDigest,'--version']}]);
 assert.ok(!calls.some(c=>c.args.some(v=>['pull','login','push','--privileged'].includes(v))));
});

test('QA loader refuses unknown loaded identity or version without registry fallback or another attempt',async()=>{
 for(const bad of ['identity','version']){const calls:string[][]=[];const execute=async(_command:string,args:string[])=>{calls.push(args);return {stdout:args[0]==='image'&&args[1]==='inspect'?JSON.stringify([{...good(),...(bad==='identity'?{Id:'sha256:'+'0'.repeat(64)}:{})}]):args[0]==='run'?'PostgREST 16.2\n':'Loaded image',stderr:''};};await assert.rejects(loadPinnedPostgrestImage({execute}),bad==='identity'?/IMAGE_ID/:/VERSION/);assert.equal(calls.length,bad==='identity'?2:3);assert.ok(!calls.some(a=>a.includes('pull')));}
});
