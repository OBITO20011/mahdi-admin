// Fixed read-only Git63 fixture for historical readers; never used by owner tools.
import assert from'node:assert/strict';import{execFileSync}from'node:child_process';import{mkdtempSync,lstatSync,readdirSync,symlinkSync,unlinkSync,rmSync}from'node:fs';import path from'node:path';import{tmpdir}from'node:os';
export async function withProductWorkbookBaseline(callback){
 const root=path.resolve(import.meta.dirname,'../..'),baseline='2dafe8433bc4efef68a82fee904590aabf5fc8ad',dir=mkdtempSync(path.join(tmpdir(),'nawasrah-workbook-baseline-')),link=path.join(dir,'node_modules');
 const noLinks=folder=>{for(const name of readdirSync(folder)){const p=path.join(folder,name),s=lstatSync(p);assert.ok(!s.isSymbolicLink(),'BASELINE_UNEXPECTED_LINK');if(s.isDirectory())noLinks(p);}};
 try{const tar=execFileSync('git',['archive','--format=tar',baseline],{cwd:root,windowsHide:true,maxBuffer:256*1024**2});execFileSync('tar',['-xf','-','-C',dir],{input:tar,windowsHide:true,maxBuffer:1024**2});noLinks(dir);symlinkSync(path.join(root,'node_modules'),link,process.platform==='win32'?'junction':'dir');return await callback(dir);}
 finally{if(lstatSync(link,{throwIfNoEntry:false})?.isSymbolicLink())unlinkSync(link);noLinks(dir);assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(dir).startsWith('nawasrah-workbook-baseline-'),'BASELINE_CLEANUP_OUTSIDE_OWN_TEMP');rmSync(dir,{recursive:true,force:true});}
}
