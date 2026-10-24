// Exact application ACL comparison. Platform ACL normalization is deliberately
// separate: service_role is a real application privilege, never ignored here.
import {isDeepStrictEqual} from 'node:util';
import {aclEntries} from './managed-catalog-policy.mjs';

export function applicationAclSnapshot(catalog){
 const snapshot={functions:[],tables:[]};
 for(const section of Object.keys(snapshot)){
  for(const row of catalog[section]??[]){
   if(row.schema!=='public')continue;
   const identity=row.identity??row.name;
   const item={schema:row.schema,identity,acl:aclEntries(row.acl,row,section)};
   if(section==='tables')item.columns=(row.columns??[]).map(c=>({name:c.name,
    acl:aclEntries(c.acl??[],row,'columns')}));
   snapshot[section].push(item);
  }
  snapshot[section].sort((a,b)=>a.identity<b.identity?-1:a.identity>b.identity?1:0);
 }
 return snapshot;
}

export function compareApplicationAcl(reference,observed){
 const expected=applicationAclSnapshot(reference),actual=applicationAclSnapshot(observed),differences=[];
 for(const section of Object.keys(expected)){
  const left=new Map(expected[section].map(r=>[r.identity,r])),right=new Map(actual[section].map(r=>[r.identity,r]));
  for(const identity of new Set([...left.keys(),...right.keys()])){
   const local=left.get(identity)??null,remote=right.get(identity)??null;
   if(!isDeepStrictEqual(local,remote))differences.push({section,schema:'public',identity,local,remote});
  }
 }
 return {ok:differences.length===0,differenceCount:differences.length,
  functionsChecked:expected.functions.length,relationsChecked:expected.tables.length,differences};
}
