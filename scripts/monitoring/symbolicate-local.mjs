import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, readFile} from 'node:fs/promises';
import {SourceMap} from 'node:module';
import path from 'node:path';

export async function symbolicateLocal({manifest,release,filename,lineno,colno}) {
 assert.match(release,/^[a-f0-9]{40}$/u,'SYMBOLICATE_RELEASE_INVALID');
 assert.ok(Number.isSafeInteger(lineno)&&lineno>0&&Number.isSafeInteger(colno)&&colno>=0,'SYMBOLICATE_POSITION_INVALID');
 const url=new URL(filename);
 assert.ok(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/assets\/[A-Za-z0-9_.-]+\.(?:js|mjs)$/u.test(url.pathname),'SYMBOLICATE_FRAME_INVALID');
 const saved=JSON.parse(await readFile(manifest,'utf8'));
 assert.equal(saved.format,1,'SYMBOLICATE_MANIFEST_INVALID');assert.equal(saved.release,release,'SYMBOLICATE_RELEASE_MISMATCH');
 const entries=saved.entries.filter(entry=>entry.file===url.pathname.slice(1));
 assert.equal(entries.length,1,'SYMBOLICATE_BUNDLE_NOT_FOUND');
 const entry=entries[0];assert.ok(/^[A-Za-z0-9_./-]+\.map$/u.test(entry.map)&&!entry.map.includes('..'),'SYMBOLICATE_MAP_PATH_INVALID');
 const mapPath=path.join(path.dirname(manifest),entry.map),stat=await lstat(mapPath);
 assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<64*1024**2,'SYMBOLICATE_MAP_INVALID');
 const bytes=await readFile(mapPath);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.mapSha256,'SYMBOLICATE_MAP_HASH_MISMATCH');
 const map=new SourceMap(JSON.parse(bytes.toString('utf8')));
 const original=map.findEntry(lineno-1,Math.max(0,colno-1));
 assert.ok(typeof original.originalSource==='string'&&Number.isSafeInteger(original.originalLine),'SYMBOLICATE_POSITION_NOT_MAPPED');
 return {ok:true,release,app:saved.app,environment:saved.environment,file:entry.file,source:original.originalSource,
  line:original.originalLine+1,column:original.originalColumn+1,...(original.name?{name:original.name}:{})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){
 try {
  const values=process.argv.slice(2),args={};
  assert.ok(values.length===10,'SYMBOLICATE_ARGUMENTS_INVALID');
  for(let i=0;i<values.length;i+=2){const key=values[i];assert.ok(['--manifest','--release','--filename','--line','--column'].includes(key)&&!Object.hasOwn(args,key),'SYMBOLICATE_ARGUMENTS_INVALID');args[key]=values[i+1];}
  console.log(JSON.stringify(await symbolicateLocal({manifest:args['--manifest'],release:args['--release'],filename:args['--filename'],lineno:Number(args['--line']),colno:Number(args['--column'])})));
 }catch(error){const code=/^SYMBOLICATE_[A-Z_]+$/u.test(error.message)?error.message:'SYMBOLICATE_LOCAL_INPUT_FAILED';console.error(JSON.stringify({ok:false,code}));process.exitCode=1;}
}
