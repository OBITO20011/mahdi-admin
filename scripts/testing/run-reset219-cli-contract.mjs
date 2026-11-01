// Offline production CLI only. Never execute apply/dry-run against a project.
import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdtemp,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {reset219Arguments} from '../operations/frankfurt-owner-reset219.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),id='00000000-0000-4000-8000-000000000001';
assert.equal(reset219Arguments([]).mode,'plan');assert.equal(reset219Arguments(['--resume','--owner-id',id]).mode,'resume');
for(const args of [['--apply'],['--resume'],['--dry-run'],['--owner-id','not-uuid'],['--apply','--resume','--owner-id',id],['--reference','local-reference-through214-ready.json'],['--target','other'],['--workdir']])assert.throws(()=>reset219Arguments(args));
assert.ok(process.argv[2],'LOCAL219_REFERENCE_REQUIRED');const workdir=await mkdtemp(path.join(tmpdir(),'nawasrah-reset219-offline-'));
const r=await exec(process.execPath,['scripts/operations/frankfurt-owner-reset219.mjs','--plan','--reference',process.argv[2],'--workdir',workdir],{cwd:root,windowsHide:true});
const result=JSON.parse(r.stdout.trim());assert.equal(result.ok,true);assert.equal(result.networkAccess,false);
const report=JSON.parse(await readFile(path.join(result.output,'report.json'),'utf8'));assert.equal(report.migrationCeiling,219);assert.equal(report.migrations,180);assert.equal(report.remoteWriteAttempted,false);assert.equal(report.exactCountsAvailable,false);assert.equal(report.reference.name,'local-reference-through219-ready.json');
console.log(JSON.stringify({ok:true,offline:true,tests:12,migrations:180,output:result.output}));
