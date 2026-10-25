// Raw stderr is classified in RAM only. Reports contain vocabulary chosen here,
// never a server-supplied message, command line, URL, path, SQL or error stack.
const messages=Object.freeze({
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
  CLIENT_EARLY_EXIT:'The SQL client exited before returning the statement result.',
  BACKUP_NOT_AVAILABLE:'No successful verified backup is available for restore.',
  OPERATION_FAILED:'The operation failed; raw error content was withheld.',
});
const tools=new Set(['psql','pg_dump','pg_dumpall','pg_restore','docker','node','filesystem','internal']);
const stages=new Set(['snapshot','source-evidence','roles-dump','complete-dump','storage-download','consistency-postcheck','archive-encrypt-verify','archive-verification','isolated-cluster-start','restore-roles','restore-complete-dump','compare-data-catalog-acl','existing-integrity-checks','tls-config','operation-preflight','restore-preflight','watchdog-read','unknown']);
const sqlstate=value=>typeof value==='string'&&/^(?:00|01|02|03|08|09|0A|0B|0F|0L|0P|0Z|20|21|22|23|24|25|26|27|28|2B|2D|2F|34|38|39|3B|3D|3F|40|42|44|53|54|55|57|58|72|F0|HV|P0|XX)[0-9A-Z]{3}$/u.test(value)?value:null;
export function postgresDiagnostic(error,{tool='internal',stage='unknown',exitCode=null,signal=null,stderr=''}={}){
  const known=error?.diagnostic;
  let category='OPERATION_FAILED',state;
  if(known&&Object.hasOwn(messages,known.category)){
    category=known.category;state=sqlstate(known.sqlstate);tool=known.tool;
    if(['unknown','operation-preflight'].includes(stage))stage=stages.has(known.stage)?known.stage:stage;
    exitCode=known.exitCode;signal=known.signal;
  }else{
    // Bounded even for malicious or accidentally enormous server errors.
    const raw=(String(stderr??'')+'\n'+String(error?.stderr??'')+'\n'+String(error?.message??'')).slice(-32768);
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
    else if(state==='25006')category='SQL_READ_ONLY_VIOLATION';
    else if(state==='42501')category='SQL_PERMISSION_DENIED';
    else if(state)category='SQL_EXECUTION_FAILED';
    else if(/SSL|TLS/iu.test(raw))category='TLS_HANDSHAKE_FAILED';
    else if(error?.code==='ENOENT')category='TOOL_NOT_FOUND';
    else if(error?.killed||error?.code==='BACKUP_SQL_TIMEOUT')category='TOOL_TIMEOUT';
    else if(error?.code==='CLIENT_EARLY_EXIT')category='CLIENT_EARLY_EXIT';
    else if(tool!=='internal')category='TOOL_FAILED';
    exitCode=typeof error?.code==='number'?error.code:exitCode;signal=error?.signal??signal;
  }
  return {formatVersion:1,stage:stages.has(stage)?stage:'unknown',tool:tools.has(tool)?tool:'internal',category,sqlstate:state,
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
