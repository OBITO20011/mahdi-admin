import{sourceBeforeIphoneDialogs}from'./source-before-iphone-dialogs.mjs';
// Only the older #64/#65/#66 contract tests use this exact, approved main view.
// Current219 SDK/service probes always read the actual merged source instead.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {entries} from './source-before-product-workbook-text.mjs';
const baseline='a4fc9dd43c75fab544df4480b5182776f2e35ef5';
execFileSync('git',['cat-file','-e',baseline+'^{commit}'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const canonical=text=>text.replaceAll('\r\n','\n');
const hash=text=>createHash('sha256').update(canonical(text)).digest('hex');
export function sourceBeforeWorkbookIntegration(file,text){
 text=sourceBeforeIphoneDialogs(file,text);
 if(text===null)return null;
 const pin=entries[file];if(!pin||hash(text)!==pin.after)return text;
 try{return execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2});}
 catch(error){if(error.status===128)return null;throw error;}
}
export function pathsBeforeWorkbookIntegration(files){return files.filter(file=>{
 const raw=readFileSync(file,'utf8');return sourceBeforeWorkbookIntegration(file,raw)!==null;
});}
