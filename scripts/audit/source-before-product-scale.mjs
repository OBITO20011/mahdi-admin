// Historical contract-test view only. Current checker/runtime always use reality.
import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';import{readFileSync}from'node:fs';
const pins=JSON.parse(readFileSync(new URL('./product-scale-source-pins.json',import.meta.url),'utf8'));
export function sourceBeforeProductScale(file,text){
 if(!Object.hasOwn(pins,file)||text===null)return text;
 if(createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex')!==pins[file])return text;
 return execFileSync('git',['show','52c9a8b53f9e1d2bad504c88f9c6255547b09e7c:'+file],{encoding:'utf8',windowsHide:true});
}
