import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';

// Diagnose only. Never rewrite an owner checkout or normalize bytes for a pin.
export function migrationLfEvidence(root){
 const directory=path.join(root,'supabase','migrations');
 const files=readdirSync(directory,{withFileTypes:true}).filter(row=>row.isFile()&&row.name.endsWith('.sql')).map(row=>row.name).sort();
 const invalid=files.filter(file=>readFileSync(path.join(directory,file)).includes(13));
 return {ok:invalid.length===0,checkedFiles:files.length,invalid,
  code:invalid.length?'MIGRATION_SQL_LF_BYTES_REQUIRED':null};
}
