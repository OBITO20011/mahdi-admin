import assert from 'node:assert/strict';
import test from 'node:test';
import {catalogDifference,normalizeRealtimePartitions} from '../scripts/testing/schema-catalog.mjs';

function fixture(date:string){
 const child='messages_'+date.replaceAll('-','_');
 const end=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 return {tables:[
  {schema:'realtime',name:'messages',kind:'p',partition:null,parents:[],columns:[{name:'id',type:'uuid',notNull:true}],acl:['realtime_admin=arwdDxt/realtime_admin']},
  {schema:'realtime',name:child,kind:'r',partition:`FOR VALUES FROM ('${date} 00:00:00') TO ('${end} 00:00:00')`,
   parents:[{schema:'realtime',name:'messages'}],columns:[{name:'id',type:'uuid',notNull:true}],acl:['realtime_admin=arwdDxt/realtime_admin']}],
  indexes:[{schema:'realtime',table:child,name:child+'_pkey',definition:`CREATE UNIQUE INDEX ${child}_pkey ON realtime.${child} USING btree (id)`,valid:true}],
  constraints:[{schema:'realtime',table:child,name:child+'_pkey',type:'p',definition:'PRIMARY KEY (id)',validated:true}],
  policies:[{schema:'realtime',table:child,name:'read',roles:['authenticated'],using:'true'}],
  schemas:[{name:'public',acl:['postgres=UC/postgres']}]};
}
const dates={beforeBuildDate:'2026-10-14',afterBuildDate:'2026-10-15'};
test('UTC-midnight daily cohorts compare by relative structure without excluding any row',()=>{
 const a=fixture('2026-10-13'),b=fixture('2026-10-14');
 assert.ok(catalogDifference(a,b).length>0);assert.deepEqual(catalogDifference(a,b,dates),[]);
 const normalized=normalizeRealtimePartitions(a,dates.beforeBuildDate);
 assert.equal(normalized.tables.length,a.tables.length);assert.equal(normalized.indexes.length,a.indexes.length);
 assert.equal(a.tables[1].name,'messages_2026_10_13','Input must remain unchanged');
 assert.deepEqual(normalized.tables[0],a.tables[0],'Parent remains literal');
});
test('real child/parent structure,permissions,indexes,checks and bounds remain strict',()=>{
 const a=fixture('2026-10-13'),good=fixture('2026-10-14');
 const mutations=[
  (b:typeof good)=>{b.tables[1].columns[0].type='text';},
  (b:typeof good)=>{b.tables[1].acl=[];},
  (b:typeof good)=>{b.tables[1].parents[0].name='wrong_parent';},
  (b:typeof good)=>{b.tables[0].columns[0].notNull=false;},
  (b:typeof good)=>{b.indexes[0].valid=false;},
  (b:typeof good)=>{b.constraints[0].validated=false;},
  (b:typeof good)=>{b.policies[0].roles=['anon'];},
  (b:typeof good)=>{b.tables[1].partition=b.tables[1].partition?.replace('2026-10-15','2026-10-16')??null;},
  (b:typeof good)=>{b.tables.pop();},
 ];
 for(const mutate of mutations){const b=structuredClone(good);mutate(b);assert.ok(catalogDifference(a,b,dates).length>0);}
});
test('other schemas,undated tables,functions and defaults are not normalized',()=>{
 const a={...fixture('2026-10-13'),functions:[{schema:'public',identity:'f()',definition:"SELECT 'messages_2026_10_13'"}]};
 const b={...fixture('2026-10-14'),functions:[{schema:'public',identity:'f()',definition:"SELECT 'messages_2026_10_14'"}]};
 assert.equal(catalogDifference(a,b,dates).length,1);
 const literalA=fixture('2026-10-13'),literalB=fixture('2026-10-14');
 literalA.constraints[0].definition="CHECK (payload = 'messages_2026_10_13')";
 literalB.constraints[0].definition="CHECK (payload = 'messages_2026_10_14')";
 assert.equal(catalogDifference(literalA,literalB,dates).length,1,'SQL literal values must remain strict');
 const outside=fixture('2026-10-13');outside.tables[1].schema='public';
 assert.equal(normalizeRealtimePartitions(outside,'2026-10-14').tables[1].name,'messages_2026_10_13');
 assert.throws(()=>normalizeRealtimePartitions(a,'2026-02-30'));
 assert.throws(()=>normalizeRealtimePartitions(a,''));
});
