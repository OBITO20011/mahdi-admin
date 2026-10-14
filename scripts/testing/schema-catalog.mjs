// Read-only semantic catalog: OIDs, creation timestamps, sizes and business
// rows are deliberately excluded; all non-system schemas are included.
export const schemaCatalogSql = `BEGIN READ ONLY;SET LOCAL search_path=public,pg_temp;
WITH namespaces AS (SELECT oid,nspname,nspowner,nspacl FROM pg_namespace
 WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema'),
relations AS (SELECT c.*,n.nspname FROM pg_class c JOIN namespaces n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p','v','m','f','S'))
SELECT jsonb_build_object(
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl) ORDER BY nspname) FROM namespaces),
 'tables',(SELECT jsonb_agg(jsonb_build_object('schema',r.nspname,'name',r.relname,'kind',r.relkind,
 'owner',pg_get_userbyid(r.relowner),'acl',r.relacl,'rls',r.relrowsecurity,'forceRls',r.relforcerowsecurity,
 'persistence',r.relpersistence,'options',r.reloptions,'replicaIdentity',r.relreplident,
 'partition',pg_get_expr(r.relpartbound,r.oid),'view',CASE WHEN r.relkind IN('v','m') THEN pg_get_viewdef(r.oid,false) END,
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'number',a.attnum,'type',format_type(a.atttypid,a.atttypmod),
 'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'acl',a.attacl,
 'collation',(SELECT collname FROM pg_collation WHERE oid=a.attcollation),
 'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY r.nspname,r.relname) FROM relations r),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',t.relname,'name',c.conname,'type',c.contype,
 'definition',pg_get_constraintdef(c.oid,false),'validated',c.convalidated,'deferrable',c.condeferrable,
 'initiallyDeferred',c.condeferred,'onUpdate',c.confupdtype,'onDelete',c.confdeltype,'match',c.confmatchtype,
 'local',c.conislocal,'noInherit',c.connoinherit,'inheritanceCount',c.coninhcount)
 ORDER BY n.nspname,t.relname,c.conname) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN namespaces n ON n.oid=t.relnamespace),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',t.relname,'name',i.relname,
 'owner',pg_get_userbyid(i.relowner),'definition',pg_get_indexdef(i.oid),'valid',x.indisvalid,'ready',x.indisready,
 'primary',x.indisprimary,'unique',x.indisunique,'clustered',x.indisclustered,'replicaIdentity',x.indisreplident)
 ORDER BY n.nspname,t.relname,i.relname) FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN namespaces n ON n.oid=t.relnamespace),
 'functions',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'identity',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'configuration',p.proconfig,'kind',p.prokind,
 'definition',pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
 FROM pg_proc p JOIN namespaces n ON n.oid=p.pronamespace WHERE p.prokind IN('f','w','p')),
 'policies',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',t.relname,'name',p.polname,'command',p.polcmd,
 'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN roleid=0 THEN 'PUBLIC' ELSE pg_get_userbyid(roleid) END ORDER BY roleid=0,pg_get_userbyid(roleid)) FROM unnest(p.polroles) roleid),
 'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY n.nspname,t.relname,p.polname)
 FROM pg_policy p JOIN pg_class t ON t.oid=p.polrelid JOIN namespaces n ON n.oid=t.relnamespace),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',t.relname,'name',g.tgname,
 'definition',pg_get_triggerdef(g.oid,false),'enabled',g.tgenabled) ORDER BY n.nspname,t.relname,g.tgname)
 FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN namespaces n ON n.oid=t.relnamespace WHERE NOT g.tgisinternal),
 'defaultPrivileges',(SELECT jsonb_agg(jsonb_build_object('role',pg_get_userbyid(d.defaclrole),'schema',COALESCE(n.nspname,''),'type',d.defaclobjtype,'acl',d.defaclacl)
 ORDER BY pg_get_userbyid(d.defaclrole),COALESCE(n.nspname,''),d.defaclobjtype) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace),
 'sequences',(SELECT jsonb_agg(jsonb_build_object('schema',r.nspname,'name',r.relname,'start',s.seqstart,'increment',s.seqincrement,
 'max',s.seqmax,'min',s.seqmin,'cache',s.seqcache,'cycle',s.seqcycle) ORDER BY r.nspname,r.relname) FROM pg_sequence s JOIN relations r ON r.oid=s.seqrelid),
 'extensions',(SELECT jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner)) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace)
);ROLLBACK;`;

export function catalogDifference(before,after) {
 const differences=[];
 for(const section of new Set([...Object.keys(before),...Object.keys(after)])){
  if(JSON.stringify(before[section])===JSON.stringify(after[section]))continue;
  const left=before[section]??[],right=after[section]??[];
  const key=v=>JSON.stringify([v.schema,v.table,v.name??v.identity,v.role,v.type]);
  const a=new Map(left.map(v=>[key(v),v])),b=new Map(right.map(v=>[key(v),v]));
  for(const identity of new Set([...a.keys(),...b.keys()])){
   if(JSON.stringify(a.get(identity))!==JSON.stringify(b.get(identity)))differences.push({section,identity,before:a.get(identity)??null,after:b.get(identity)??null});
  }
 }
 return differences;
}
