// Registry-independent test image. Same official v16.1 bytes; no credentials or network pulls.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
const executeDefault=async(command,args,options)=>{const result=await exec(command,args,options);return {stdout:String(result.stdout),stderr:String(result.stderr)};};
export const pinnedPostgrest=Object.freeze({
 archive:'tests/fixtures/postgrest-v16.1-linux-amd64.tar.gz',
 archiveSha256:'f68c7e96cf47296e13b2db0a4b52fd040df216bc082c8218621bf5b8a33d1d91',
 indexDigest:'sha256:5922bde07147b82b1c9d8f749e48c1e5b99ebb233f3888bb7ab65f07cf4ac82d',
 amd64Manifest:'sha256:73e76c305027cb1119bc7c6ab82449d9e1a50a9e8697f4ebac5443dc63590c90',
 configDigest:'sha256:eb4951a2f9ac02288100937995af3cb7fb64c296b1228405de5d77ca4dd3410d',
 layerDigest:'sha256:bcf274f2d0acaa2c53b14a8a6c34155eae760b02cc1cf1d0dc41eccf2fa730d2',
 rootLayer:'sha256:b36c5c9c3de87601320405dad36adca2832c7891f4b5231b080280c1bfa7ade4',
 tag:'nawasrah-qa-postgrest:v16.1-pinned',
});
export function assertPinnedPostgrestArchive(bytes){
 assert.equal(createHash('sha256').update(bytes).digest('hex'),pinnedPostgrest.archiveSha256,'PINNED_POSTGREST_ARCHIVE_SHA256');
}
export function assertPinnedPostgrestImage(info){
 // Docker's containerd image store uses the index ID; classic Docker uses the config ID.
 assert.ok([pinnedPostgrest.indexDigest,pinnedPostgrest.configDigest].includes(info.Id),'PINNED_POSTGREST_IMAGE_ID');
 assert.equal(info.Os,'linux','PINNED_POSTGREST_OS');assert.equal(info.Architecture,'amd64','PINNED_POSTGREST_ARCH');
 assert.deepEqual(info.RootFS,{Type:'layers',Layers:[pinnedPostgrest.rootLayer]},'PINNED_POSTGREST_ROOTFS');
 assert.equal(info.Config.User,'1000','PINNED_POSTGREST_USER');assert.deepEqual(info.Config.Cmd,['/bin/postgrest'],'PINNED_POSTGREST_CMD');
 assert.deepEqual(info.Config.Env??[],[],'PINNED_POSTGREST_IMAGE_ENV');assert.ok(info.Config.Entrypoint==null||info.Config.Entrypoint.length===0,'PINNED_POSTGREST_ENTRYPOINT');
 return info.Id;
}
export async function loadPinnedPostgrestImage({execute=executeDefault}={}){
 const archive=path.join(root,pinnedPostgrest.archive);assertPinnedPostgrestArchive(await readFile(archive));
 await execute('docker',['image','load','--input',archive],{windowsHide:true,maxBuffer:1024**2});
 const inspected=await execute('docker',['image','inspect',pinnedPostgrest.tag],{windowsHide:true,maxBuffer:1024**2});
 const images=JSON.parse(inspected.stdout);assert.equal(images.length,1,'PINNED_POSTGREST_ONE_IMAGE');
 const id=assertPinnedPostgrestImage(images[0]);
 const version=await execute('docker',['run','--rm','--network=none','--entrypoint','/bin/postgrest',id,'--version'],{windowsHide:true,maxBuffer:1024**2});
 assert.equal(version.stdout.trim(),'PostgREST 16.1','PINNED_POSTGREST_VERSION');
 return id;
}
