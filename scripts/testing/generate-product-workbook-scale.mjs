// Re-author fictional XLSX fixtures using the bundled public Artifact Tool only.
import assert from'node:assert/strict';import{mkdir,writeFile,access}from'node:fs/promises';import path from'node:path';import os from'node:os';import{execFile}from'node:child_process';import{promisify}from'node:util';
import{productWorkbookScaleData}from'./product-workbook-scale-data.ts';import{PRODUCT_WORKBOOK_COLUMNS as C,FLAVOR_WORKBOOK_COLUMNS as F}from'../../src/features/goLive/productWorkbook.ts';
assert.ok(process.argv.length===4&&process.argv[2]==='--output','SCALE_GENERATOR_NEW_OUTPUT_REQUIRED');
const output=path.resolve(process.argv[3]);await mkdir(output,{recursive:false});const model=path.join(output,'model.json');await writeFile(model,JSON.stringify({...productWorkbookScaleData(),columnKeys:{products:C.map(c=>c.key),flavors:F.map(c=>c.key)}}));
const runtime=process.env.NAWASRAH_ARTIFACT_NODE??path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'+(process.platform==='win32'?'.exe':''));await access(runtime);
const{stdout}=await promisify(execFile)(runtime,[path.join(import.meta.dirname,'export-product-workbook-scale.mjs'),'--model',model,'--output',path.join(output,'files')],{windowsHide:true,maxBuffer:1024**2});console.log(stdout.trim());
