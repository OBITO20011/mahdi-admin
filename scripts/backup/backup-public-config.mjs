// Owner17Oct: nightly backup remains on the OLD project until an explicit move.
// Public browser credential only; deliberately independent of frontend defaults.
export const BACKUP_PROJECT_REF='acjtabdqqnpwhdvbvnyw';
const publicConfig=Object.freeze({
 url:'https://acjtabdqqnpwhdvbvnyw.supabase.co',
 publishableKey:'sb_publishable_XYq8HBYT6Pxa2VdRdi69CA_012vvfp5',
});
export function backupPublicConfigForProject(linkedRef){
 if(linkedRef!==BACKUP_PROJECT_REF||new URL(publicConfig.url).hostname!==`${linkedRef}.supabase.co`)
  throw new Error('BACKUP_PROJECT_MISMATCH: database and Storage must use the reviewed backup project.');
 return {...publicConfig};
}
export function assertBackupDatabaseProject(connection){
 const target=new URL(connection);
 const direct=target.hostname===`db.${BACKUP_PROJECT_REF}.supabase.co`&&target.username==='postgres';
 const pooler=target.hostname.endsWith('.pooler.supabase.com')&&target.username===`postgres.${BACKUP_PROJECT_REF}`;
 if(target.protocol!=='postgresql:'||(!direct&&!pooler))throw new Error('BACKUP_DATABASE_PROJECT_MISMATCH');
}
