// Owner25Oct: BOTH approved projects remain backed up. Legacy default is unchanged.
// Public browser credential only; deliberately independent of frontend defaults.
export const BACKUP_PROJECT_REF='acjtabdqqnpwhdvbvnyw';
export const FRANKFURT_BACKUP_REF='kzevmysfydaslxcerogt';
export const APPROVED_BACKUP_REFS=Object.freeze([BACKUP_PROJECT_REF,FRANKFURT_BACKUP_REF]);
export function assertApprovedBackupProject(ref){
 if(!APPROVED_BACKUP_REFS.includes(ref))throw new Error('BACKUP_PROJECT_NOT_APPROVED');
 return ref;
}
const publicConfig=Object.freeze({
 url:'https://acjtabdqqnpwhdvbvnyw.supabase.co',
 publishableKey:'sb_publishable_XYq8HBYT6Pxa2VdRdi69CA_012vvfp5',
});
export function backupPublicConfigForProject(linkedRef){
 if(linkedRef!==BACKUP_PROJECT_REF||new URL(publicConfig.url).hostname!==`${linkedRef}.supabase.co`)
  throw new Error('BACKUP_PROJECT_MISMATCH: database and Storage must use the reviewed backup project.');
 return {...publicConfig};
}
export function assertBackupDatabaseProject(connection,projectRef=BACKUP_PROJECT_REF){
 assertApprovedBackupProject(projectRef);
 const target=new URL(connection);
 const direct=target.hostname===`db.${projectRef}.supabase.co`&&target.username==='postgres';
 const pooler=/^aws-[0-9]+-[a-z]+-[a-z]+-[0-9]+\.pooler\.supabase\.com$/u.test(target.hostname)&&target.username===`postgres.${projectRef}`;
 if(target.protocol!=='postgresql:'||target.password||target.hash||target.search||target.pathname!=='/postgres'||(!direct&&!pooler)||!['','5432'].includes(target.port))throw new Error('BACKUP_DATABASE_PROJECT_MISMATCH');
}
