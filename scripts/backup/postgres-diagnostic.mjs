// Raw stderr is classified in RAM only. Reports contain vocabulary chosen here,
// never a server-supplied message, command line, URL, path, SQL or error stack.
const messages=Object.freeze({
  LOCKED:'Another operation owns the lock; no work was started.',
  LOCK_FILE_INVALID:'The lock metadata is invalid; manual inspection is required.',
  LOCK_PROCESS_CHECK_FAILED:'The lock owner could not be checked safely; nothing was removed.',
  LOCK_CLEANUP_FAILED:'The operation lock could not be released safely.',
  MISSING_ENV:'A required environment variable is missing.',
  DPAPI_UNPROTECT_FAILED:'A protected local credential could not be decrypted.',
  PG_BIN_NOT_FOUND:'A required PostgreSQL executable was not found in the configured directory.',
  CONFIG_INVALID:'The owner configuration is invalid.',
  CONFIG_READ_FAILED:'The owner configuration could not be read.',
  ARCHIVE_PASSPHRASE_INVALID:'The archive passphrase does not meet the existing encryption requirement.',
  FILE_IO_FAILED:'A required local file operation failed.',
  REPORT_WRITE_FAILED:'The operation report could not be saved.',
  MODE_INVALID:'The requested owner operation is not supported.',
  APPLY_REQUIRED:'This owner operation requires explicit Apply.',
  ADMIN_REQUIRED:'This owner operation requires an elevated PowerShell session.',
  TLS_CA_UNTRUSTED:'TLS certificate chain is not trusted by the configured CA.',
  TLS_HOSTNAME_MISMATCH:'TLS certificate does not match the requested hostname.',
  TLS_ROOT_CERT_MISSING:'The configured TLS root certificate cannot be read.',
  TLS_CA_BUNDLE_INVALID:'The bundled public CA failed its integrity or validity check.',
  TLS_CERT_EXPIRED:'A TLS certificate is expired or not yet valid.',
  TLS_HANDSHAKE_FAILED:'TLS negotiation failed; certificate and hostname verification remain required.',
  AUTH_REJECTED:'Database authentication was rejected.',
  POOLER_TENANT_USER_NOT_FOUND:'The pooler could not find the requested tenant or user.',
  POOLER_STARTUP_OPTION_UNSUPPORTED:'The server or pooler rejected a startup option.',
  DNS_FAILURE:'The database hostname could not be resolved.',
  CONNECT_TIMEOUT:'The database connection timed out.',
  CONNECT_FAILED:'The database TCP connection could not be established.',
  TOOL_SERVER_VERSION_MISMATCH:'The dump tool cannot dump this server version.',
  SNAPSHOT_NOT_AVAILABLE:'The exported snapshot is unavailable to the dump connection.',
  SQL_READ_ONLY_VIOLATION:'A statement was rejected by the read-only transaction.',
  SQL_PERMISSION_DENIED:'The database role lacks permission for a required backup read.',
  SQL_EXECUTION_FAILED:'A PostgreSQL statement failed; inspect SQLSTATE.',
  TOOL_NOT_FOUND:'A required native tool was not found.',
  TOOL_TIMEOUT:'A native tool exceeded its time limit.',
  TOOL_FAILED:'A native tool failed before completing its work.',
  RESTORE_PLATFORM_SETTINGS_UNSUPPORTED:'A captured platform setting is unsupported;restore was not accepted.',
  RESTORE_EXTENSION_UNAVAILABLE:'A required captured extension version is unavailable in the isolated image.',
  RESTORE_SQL_ERROR:'PostgreSQL rejected an object or data item during strict restore.',
  RESTORE_LOG_CAPTURE_FAILED:'A sanitized isolated restore log could not be saved.',
  CLIENT_EARLY_EXIT:'The SQL client exited before returning the statement result.',
  BACKUP_NOT_AVAILABLE:'No successful verified backup is available for restore.',
  OPERATION_FAILED:'The operation failed; raw error content was withheld.',
});
const tools=new Set(['psql','pg_dump','pg_dumpall','pg_restore','docker','node','powershell','filesystem','internal']);
const stages=new Set(['config-load','owner-env','pg-bin-check','operation-lock','lock-cleanup','operation-report','snapshot','source-evidence','roles-dump','complete-dump','storage-download','consistency-postcheck','archive-encrypt-verify','archive-verification','isolated-cluster-start','restore-roles','restore-toc','restore-schemas','restore-extension-preflight','restore-complete-dump','restore-platform-postinit','restore-log-capture','compare-data-catalog-acl','existing-integrity-checks','tls-config','operation-preflight','restore-preflight','watchdog-read','unknown']);
export const OWNER_ENV_NAMES=Object.freeze(['NAWASRAH_FF_CONFIG','NAWASRAH_FF_DB_PASSWORD','NAWASRAH_FF_PASSPHRASE','NAWASRAH_R2_ACCOUNT_ID','NAWASRAH_R2_ACCESS_KEY_ID','NAWASRAH_R2_SECRET_ACCESS_KEY','NAWASRAH_DEV_TELEGRAM_BOT_TOKEN','NAWASRAH_DEV_TELEGRAM_CHAT_ID']);
const sqlstate=value=>typeof value==='string'&&/^(?:00|01|02|03|08|09|0A|0B|0F|0L|0P|0Z|20|21|22|23|24|25|26|27|28|2B|2D|2F|34|38|39|3B|3D|3F|40|42|44|53|54|55|57|58|72|F0|HV|P0|XX)[0-9A-Z]{3}$/u.test(value)?value:null;
const identifier=value=>typeof value==='string'&&/^[a-zA-Z_][a-zA-Z0-9_$]{0,127}$/u.test(value)?value:null;
const tocTypes=['EVENT TRIGGER','MATERIALIZED VIEW','TABLE DATA','SEQUENCE SET','DEFAULT ACL','PUBLICATION TABLE','PUBLICATION','SUBSCRIPTION','FK CONSTRAINT','CONSTRAINT','EXTENSION','FUNCTION','PROCEDURE','TRIGGER','SCHEMA','TABLE','VIEW','SEQUENCE','INDEX','TYPE','DOMAIN','ACL','COMMENT'];
const restoreMessages=Object.freeze({
  MISSING_EXTENSION:'ERROR: required extension is not available in the isolated image.',
  MISSING_LIBRARY:'ERROR: required extension library or preload is not available.',
  MISSING_ROLE:'ERROR: required role does not exist.',
  MISSING_SCHEMA:'ERROR: required schema does not exist.',
  MISSING_OBJECT:'ERROR: required relation or function does not exist.',
  DUPLICATE_OBJECT:'ERROR: an object already exists.',
  PERMISSION:'ERROR: insufficient privilege or object ownership.',
  DUPLICATE_DATA:'ERROR: a uniqueness constraint was violated;data values withheld.',
  FOREIGN_KEY:'ERROR: a foreign key constraint was violated;data values withheld.',
  INVALID_SETTING:'ERROR: a server configuration setting is unsupported.',
  EXTENSION_VERSION:'ERROR: extension version or update path is unsupported.',
  SQL_ERROR:'ERROR: restore failed;raw SQL,DETAIL,CONTEXT and values withheld.',
});
export function safeRestoreFields(value){
  const result={};
  if(value?.toc&&tocTypes.includes(value.toc.type)&&identifier(value.toc.name)
    &&(value.toc.schema===null||identifier(value.toc.schema)))result.toc={type:value.toc.type,schema:value.toc.schema,name:value.toc.name};
  if(Object.hasOwn(restoreMessages,value?.restoreErrorCode??'')){
    result.restoreErrorCode=value.restoreErrorCode;result.restoreMessage=restoreMessages[value.restoreErrorCode];
  }
  return result;
}
export function restoreErrorFields(stderr='',{tocList=''}={}){
  const raw=String(stderr).slice(-65536),result={};
  const match=[...raw.matchAll(/(?:from TOC entry|TOC entry)\s+(\d+);\s+\d+\s+\d+\s+([^\r\n]+)/gu)].at(-1);
  const listed=match?String(tocList).split(/\r?\n/u).find(line=>line.startsWith(match[1]+';'))?.replace(/^\d+;\s+\d+\s+\d+\s+/u,''):null;
  const entry=listed??match?.[2];
  if(entry){
    const type=tocTypes.find(t=>entry.startsWith(t+' '));
    if(type){
      const rest=entry.slice(type.length+1).trim().split(/\s+/u);
      const hasSchema=!!listed||rest[0]==='-'||rest.length>=3&&!rest[0]?.includes('(');
      let schema=hasSchema&&rest[0]!=='-'?identifier(rest[0]):null,name=identifier(rest[hasSchema?1:0]?.split('(')[0]);
      // COMMENT/ACL entries can refer to another object kind;retain only its name.
      if(['COMMENT','ACL'].includes(type)&&tocTypes.includes(rest[1]))name=identifier(rest[2]?.split('(')[0]);
      if(name&&(schema===null||identifier(schema)))result.toc={type,schema,name};
    }
  }
  const state=sqlstate(raw.match(/(?:ERROR|FATAL|PANIC):\s+([0-9A-Z]{5}):/u)?.[1])??sqlstate(raw.match(/\[state=([0-9A-Z]{5})\]\s+(?:ERROR|FATAL|PANIC):/u)?.[1]);
  let code='SQL_ERROR';
  if(/extension .* is not available|could not open extension control file/iu.test(raw))code='MISSING_EXTENSION';
  else if(/could not access file.*No such file|could not load library|must be loaded via shared_preload_libraries/iu.test(raw))code='MISSING_LIBRARY';
  else if(/role .* does not exist/iu.test(raw))code='MISSING_ROLE';
  else if(/schema .* does not exist/iu.test(raw))code='MISSING_SCHEMA';
  else if(/(?:relation|function) .* does not exist/iu.test(raw))code='MISSING_OBJECT';
  else if(state==='23505'||/duplicate key value/iu.test(raw))code='DUPLICATE_DATA';
  else if(state==='23503'||/violates foreign key/iu.test(raw))code='FOREIGN_KEY';
  else if(/already exists/iu.test(raw))code='DUPLICATE_OBJECT';
  else if(state==='42501'||/permission denied|must be owner|must be superuser/iu.test(raw))code='PERMISSION';
  else if(/unrecognized configuration parameter/iu.test(raw))code='INVALID_SETTING';
  else if(/extension .* has no (?:installation|update) script|no update path|version mismatch/iu.test(raw))code='EXTENSION_VERSION';
  return {...safeRestoreFields({...result,restoreErrorCode:code}),sqlstate:state};
}
export function postgresDiagnostic(error,{tool='internal',stage='unknown',exitCode=null,signal=null,stderr=''}={}){
  const known=error?.diagnostic;
  let category='OPERATION_FAILED',state;
  if(known&&Object.hasOwn(messages,known.category)){
    category=known.category;state=sqlstate(known.sqlstate);tool=known.tool;
    if(['unknown','operation-preflight'].includes(stage))stage=stages.has(known.stage)?known.stage:stage;
    exitCode=known.exitCode;signal=known.signal;
  }else{
    // Bounded even for malicious or accidentally enormous server errors.
    const serverText=String(stderr??'')+'\n'+String(error?.stderr??'');
    // execFile.message embeds the command/URI (including the word sslmode).
    // Never classify that as a TLS failure when stderr identifies another cause.
    const raw=(serverText.trim()?serverText:error?.cmd?'':String(error?.message??'')).slice(-32768);
    state=sqlstate(raw.match(/(?:ERROR|FATAL|PANIC):\s+([0-9A-Z]{5}):/u)?.[1]);
    if(/root certificate file.*does not exist|could not (?:open|read).*root certificate|no certificate or crl found/iu.test(raw))category='TLS_ROOT_CERT_MISSING';
    else if(/server certificate.*does not match|hostname mismatch|does not match.*host name/iu.test(raw))category='TLS_HOSTNAME_MISMATCH';
    else if(/certificate has expired|certificate expired|certificate is not yet valid/iu.test(raw))category='TLS_CERT_EXPIRED';
    else if(/certificate verify failed|self.signed certificate|unable to (?:get|verify).*issuer|unknown ca/iu.test(raw))category='TLS_CA_UNTRUSTED';
    else if(/password authentication failed|no password supplied|SASL.*signature/iu.test(raw)||state?.startsWith('28'))category='AUTH_REJECTED';
    else if(/tenant or user not found|tenant.*not found/iu.test(raw))category='POOLER_TENANT_USER_NOT_FOUND';
    else if(/unsupported startup parameter|unsupported startup option|invalid.*startup.*option/iu.test(raw))category='POOLER_STARTUP_OPTION_UNSUPPORTED';
    else if(/server version mismatch|aborting because of server version/iu.test(raw))category='TOOL_SERVER_VERSION_MISMATCH';
    else if(/invalid snapshot identifier|snapshot.*does not exist|snapshot.*no longer/iu.test(raw))category='SNAPSHOT_NOT_AVAILABLE';
    else if(/could not translate host name|Name or service not known|ENOTFOUND|EAI_AGAIN/iu.test(raw))category='DNS_FAILURE';
    else if(/timeout expired|connection timed out|ETIMEDOUT/iu.test(raw))category='CONNECT_TIMEOUT';
    else if(/connection refused|network is unreachable|no route to host|could not connect to server/iu.test(raw))category='CONNECT_FAILED';
    else if(state==='25006'||/cannot execute.*read.only transaction/iu.test(raw))category='SQL_READ_ONLY_VIOLATION';
    else if(state==='42501'||/permission denied|must be owner of|not permitted to read/iu.test(raw))category='SQL_PERMISSION_DENIED';
    else if(state)category='SQL_EXECUTION_FAILED';
    else if(/SSL|TLS/iu.test(raw))category='TLS_HANDSHAKE_FAILED';
    else if(raw==='FRANKFURT_OPERATION_LOCKED_CHECK_OWNER_PROCESS')category='LOCKED';
    else if(['EACCES','EPERM','EROFS','ENOSPC','EIO'].includes(error?.code))category='FILE_IO_FAILED';
    else if(error?.code==='ENOENT')category='TOOL_NOT_FOUND';
    else if(error?.killed||error?.code==='BACKUP_SQL_TIMEOUT')category='TOOL_TIMEOUT';
    else if(error?.code==='CLIENT_EARLY_EXIT')category='CLIENT_EARLY_EXIT';
    else if(!['internal','node','filesystem','powershell'].includes(tool))category='TOOL_FAILED';
    exitCode=typeof error?.code==='number'?error.code:exitCode;signal=error?.signal??signal;
  }
  return {formatVersion:1,stage:stages.has(stage)?stage:'unknown',tool:tools.has(tool)?tool:'internal',category,sqlstate:state,
    ...safeRestoreFields(known),
    ...(category==='MISSING_ENV'&&OWNER_ENV_NAMES.includes(known?.variable)?{variable:known.variable}:{}),
    libpqMessage:messages[category],messagePolicy:'canonical-classification-no-raw-output',
    exitCode:Number.isInteger(exitCode)&&exitCode>=-2147483648&&exitCode<=4294967295?exitCode:null,
    signal:['SIGINT','SIGTERM','SIGKILL'].includes(signal)?signal:null};
}
export function diagnosticError(code,diagnostic){
  const error=new Error(code);error.diagnostic=postgresDiagnostic({diagnostic});return error;
}
export function classifiedError(category,options={}){
  if(!Object.hasOwn(messages,category))throw new Error('UNKNOWN_SAFE_ERROR_CATEGORY');
  return diagnosticError(category,{category,...options});
}
