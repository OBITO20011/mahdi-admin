import {mkdir,open,readFile,writeFile,rename,unlink,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {classifiedError,diagnosticError,postgresDiagnostic,OWNER_ENV_NAMES} from '../backup/postgres-diagnostic.mjs';

export async function saveOwnerJson(file,data){
  await mkdir(path.dirname(file),{recursive:true});
  const temp=file+'.'+randomUUID()+'.tmp';
  try{await writeFile(temp,JSON.stringify(data,null,2)+'\n');await rename(temp,file);}
  finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export function requiredOwnerEnv(env,variable){
  if(!OWNER_ENV_NAMES.includes(variable))throw classifiedError('CONFIG_INVALID',{stage:'owner-env'});
  const value=env[variable];
  if(typeof value!=='string'||!value.trim())throw classifiedError('MISSING_ENV',{tool:'node',stage:'owner-env',variable});
  return value;
}
export async function releaseOwnerLock(lock,file,contents){
  let failure,identity;
  try{identity=await lock.stat();}catch{failure=classifiedError('LOCK_CLEANUP_FAILED',{stage:'lock-cleanup',tool:'filesystem'});}
  // Closing and unlinking are independent: neither failure may skip the other.
  try{await lock.close();}catch{failure=classifiedError('LOCK_CLEANUP_FAILED',{stage:'lock-cleanup',tool:'filesystem'});}
  try{
    const current=await stat(file);
    if(!identity||current.ino!==identity.ino||current.dev!==identity.dev
      ||contents!==undefined&&await readFile(file,'utf8')!==contents)throw new Error('LOCK_REPLACED');
    await unlink(file);
  }catch{failure??=classifiedError('LOCK_CLEANUP_FAILED',{stage:'lock-cleanup',tool:'filesystem'});}
  if(failure)throw failure;
}
export async function withOwnerOperation({mode,root,backupRoot,run,reportWriter=saveOwnerJson}){
  const file=path.join(root,['Watchdog','TestAlert'].includes(mode)?'monitor.lock':'backup-offsite.lock');
  const contents=JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),mode,nonce:randomUUID()});
  let lock,result,failure,report,metadataWritten=false;
  try{
    await mkdir(root,{recursive:true});
    try{lock=await open(file,'wx');}catch(error){
      throw classifiedError(error.code==='EEXIST'?'LOCKED':'FILE_IO_FAILED',{stage:'operation-lock',tool:'filesystem'});
    }
    // Everything following successful creation,including metadata/env getters,is guarded.
    await lock.writeFile(contents);
    metadataWritten=true;
    result=await run();
  }catch(error){const diagnostic=postgresDiagnostic(error,{stage:'operation-preflight'});failure=diagnosticError('FRANKFURT_OWNER_OPERATION_FAILED:'+diagnostic.category,diagnostic);}
  finally{
    // Report while still owning the lock;cleanup is a separate nested finally.
    try{
      report={ok:!failure&&result?.ok!==false,mode,at:new Date().toISOString(),...(failure?{code:'FRANKFURT_OWNER_OPERATION_FAILED_CHECK_STAGE_REPORTS',diagnostic:postgresDiagnostic(failure)}:{})};
      if(lock&&mode==='Backup'&&failure&&['owner-env','pg-bin-check','operation-preflight'].includes(report.diagnostic.stage)){
        try{await saveOwnerJson(path.join(backupRoot,'last-backup-status.json'),{...report,stage:report.diagnostic.stage,error:'COMPLETE_BACKUP_FAILED_NO_SUCCESS_CLAIM'});}
        catch{report.phaseReportWriteFailed=true;}
      }
      try{
        await reportWriter(path.join(root,'operation-'+mode+'.json'),report);
        if(failure)failure.operationReported=true;
      }catch{
        const diagnostic=postgresDiagnostic(classifiedError('REPORT_WRITE_FAILED',{tool:'filesystem',stage:'operation-report'}));
        if(failure)failure.reportDiagnostic=diagnostic;else failure=diagnosticError('REPORT_WRITE_FAILED',diagnostic);
        try{await saveOwnerJson(path.join(root,'operation-'+mode+'-fallback.json'),{...report,ok:false,reportDiagnostic:diagnostic});failure.reportFallbackSaved=true;}catch{/* CLI is the last safe channel when no file can be written. */}
      }
    }finally{
      if(lock){
        try{await releaseOwnerLock(lock,file,metadataWritten?contents:undefined);}
        catch(error){
          const cleanupDiagnostic=postgresDiagnostic(error);
          if(failure)failure.cleanupDiagnostic=cleanupDiagnostic;else failure=error;
          try{await saveOwnerJson(path.join(root,'operation-'+mode+'.json'),{...report,ok:false,diagnostic:postgresDiagnostic(failure),cleanupDiagnostic});failure.operationReported=true;}
          catch{failure.reportDiagnostic=postgresDiagnostic(classifiedError('REPORT_WRITE_FAILED',{stage:'operation-report',tool:'filesystem'}));}
        }
      }
    }
  }
  if(failure)throw failure;
  return result;
}
