import{sourceBeforeStorefrontSpeed}from'./source-before-storefront-speed.mjs';
// Historical contract-test view only. Current checker/runtime always use reality.
import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';import{readFileSync}from'node:fs';
const pins=Object.fromEntries(JSON.parse(readFileSync(new URL('./product-scale-source-pins.json',import.meta.url),'utf8')));
const originals=new Map();
export function sourceBeforeProductScale(file,text){
 text=sourceBeforeStorefrontSpeed(file,text);
 if(!Object.hasOwn(pins,file)||text===null)return text;
 if(createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex')!==pins[file])return text;
 if(!originals.has(file))originals.set(file,execFileSync('git',['show','87f29abad10718bd533a6f9f0789194d967ee0f3:'+file],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024**2,stdio:['ignore','pipe','pipe']}));
 return originals.get(file);
}
