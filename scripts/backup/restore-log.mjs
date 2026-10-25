import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {restoreErrorFields,postgresDiagnostic} from './postgres-diagnostic.mjs';
const exec=promisify(execFile);
// A canonical event summary,not a redacted copy of arbitrary SQL/error text.
// DETAIL,CONTEXT,STATEMENT,COPY data,paths,credentials and business values never survive.
export function sanitizedRestoreLog(raw){
  const tail=String(raw??'').slice(-65536),events=[];
  for(const line of tail.split(/\r?\n/u)){
    if(!/(?:ERROR|FATAL|PANIC):/u.test(line))continue;
    const fields=restoreErrorFields(line);
    events.push({severity:line.includes('FATAL:')?'FATAL':line.includes('PANIC:')?'PANIC':'ERROR',...fields});
  }
  return {formatVersion:1,policy:'canonical-errors-only-no-detail-context-statement-or-values',events:events.slice(-40)};
}
export async function saveRestoreLogs({reportPath,stderr,serverLog,tocList=''}){
  const parent=path.join(path.dirname(reportPath),'restore-diagnostics');
  await mkdir(parent,{recursive:true});
  const folder=await mkdtemp(path.join(parent,'restore-'));
  // Establish a restrictive directory ACL BEFORE persisting even sanitized content.
  if(process.platform==='win32')await exec('icacls.exe',[folder,'/inheritance:r','/grant:r','*S-1-5-32-544:(OI)(CI)F'],{windowsHide:true});
  else {const {chmod}=await import('node:fs/promises');await chmod(folder,0o700);}
  const error=restoreErrorFields(stderr+'\n'+serverLog,{tocList});
  await writeFile(path.join(folder,'pg-restore-sanitized.json'),JSON.stringify({formatVersion:1,...error,stderrSummary:sanitizedRestoreLog(stderr)},null,2)+'\n',{mode:0o600});
  await writeFile(path.join(folder,'server-tail-sanitized.json'),JSON.stringify(sanitizedRestoreLog(serverLog),null,2)+'\n',{mode:0o600});
  return {saved:true,folder,files:['pg-restore-sanitized.json','server-tail-sanitized.json'],rawOutputSaved:false,administratorsOnly:process.platform==='win32'};
}
export function restoreToolError(error,{stage,stderr=error?.stderr??'',serverLog='',tocList=''}){
  const base=postgresDiagnostic(error,{tool:'pg_restore',stage,stderr});
  const fields=restoreErrorFields(stderr+'\n'+serverLog,{tocList});
  const category=['TOOL_FAILED','SQL_PERMISSION_DENIED','SQL_EXECUTION_FAILED'].includes(base.category)?'RESTORE_SQL_ERROR':base.category;
  return {diagnostic:postgresDiagnostic({diagnostic:{...base,category,...fields,sqlstate:fields.sqlstate??base.sqlstate}})};
}
