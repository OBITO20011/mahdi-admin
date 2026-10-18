import {writeFileSync,renameSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
/** Same-directory replace: never truncate a checkpoint opened by an editor. */
export function writeAtomicUtf8(filename,text){
 const temporary=filename+'.tmp-'+randomUUID();
 try{writeFileSync(temporary,text,{encoding:'utf8',flag:'wx'});renameSync(temporary,filename);}
 finally{rmSync(temporary,{force:true});}
}
