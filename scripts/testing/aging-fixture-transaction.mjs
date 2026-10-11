import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// One real PostgreSQL transaction pins CURRENT_TIMESTAMP for fixture writes,
// authenticated readers, paging and independent oracles. No clock mocking.
export function fixtureCommand(text,number){
 let body=text.trim(),readOnly=false,rollback=false;
 const begin=body.match(/^BEGIN(?:\s+READ\s+ONLY)?\s*;/iu);
 if(begin){
  readOnly=/READ\s+ONLY/iu.test(begin[0]);
  const end=body.match(/\b(COMMIT|ROLLBACK)\s*;\s*$/iu);
  assert.ok(end,'Fixture transaction wrapper must have an explicit end');
  rollback=end[1].toUpperCase()==='ROLLBACK';
  body=body.slice(begin[0].length,end.index);
 }
 const point=`aging_request_${number}`,marker=`AGING_END_${number}`;
 return {marker,sql:`SAVEPOINT ${point};
${readOnly?'SET LOCAL transaction_read_only=on;':''}
${body}
\\echo AGING_STATE_${number} :ERROR :SQLSTATE
\\if :ERROR
ROLLBACK TO SAVEPOINT ${point};
\\else
${rollback?`ROLLBACK TO SAVEPOINT ${point};`:''}
\\endif
RELEASE SAVEPOINT ${point};
RESET ROLE;
RESET request.jwt.claims;
\\echo ${marker}
\\warn ${marker}
`};
}

export async function openAgingFixtureTransaction(container,{cwd}={}){
 assert.match(container,/^supabase_db_nawasrah-package-f-(?:aging|crm-filters)-test$/u);
 const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At',
  '-v','ON_ERROR_STOP=0'],{cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 let current,sequence=0,tail=Promise.resolve(),closed=false;
 const exited=new Promise((resolve,reject)=>{
  child.on('error',reject);child.on('close',code=>{closed=true;
   if(current)current.reject(Error('Aging fixture connection closed before command completed'));
   if(code===0)resolve();else reject(Error('Aging fixture psql exit'+code));
  });
 });
 // Consume both streams through their own end marker,including split UTF-8.
 const finish=()=>{
  if(!current?.stdoutEnd||!current?.stderrEnd)return;
  const request=current;current=undefined;
  if(request.failed||/^\s*(?:ERROR|FATAL):/mu.test(request.err.join('\n')))
   request.reject(Error('Aging fixture SQL: '+request.err.join('\n').slice(-6000)));
  else request.resolve(request.out.join('\n').trim());
 };
 const stdout=createInterface({input:child.stdout}),stderr=createInterface({input:child.stderr});
 stdout.on('line',line=>{
  if(!current)return;
  if(line===current.marker){current.stdoutEnd=true;finish();}
  else if(line.startsWith(`AGING_STATE_${current.number} `))current.failed=line.includes(' true ');
  else current.out.push(line);
 });
 stderr.on('line',line=>{
  if(!current)return;
  if(line===current.marker){current.stderrEnd=true;finish();}
  else current.err.push(line);
 });
 child.stdin.write("SET statement_timeout='60s';SET lock_timeout='30s';BEGIN;\n");
 const sql=(text,{variables={},seed=false}={})=>{
  assert.equal(seed,false,'Large scale seeding stays on the existing bulk transport before the pinned read phase');
  assert.deepEqual(variables,{},'Pinned aging requests do not redefine scale variables');
  const result=tail.then(()=>new Promise((resolve,reject)=>{
   assert.equal(closed,false,'Aging fixture connection must remain open');
   const number=++sequence,command=fixtureCommand(text,number);
   current={number,marker:command.marker,out:[],err:[],resolve,reject,failed:false,stdoutEnd:false,stderrEnd:false};
   child.stdin.write(command.sql,error=>{if(error){current=undefined;reject(error);}});
  }));
  tail=result.catch(()=>undefined);return result;
 };
 const started=JSON.parse(await sql("SELECT jsonb_build_object('transactionAt',CURRENT_TIMESTAMP,'ammanDate',(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE,'backend',pg_backend_pid());"));
 console.log(JSON.stringify({stage:'aging fixture database clock',...started}));
 await assert.rejects(()=>sql('BEGIN READ ONLY;UPDATE public.customers SET full_name=full_name WHERE false;ROLLBACK;'),/read.only/iu);
 assert.deepEqual(JSON.parse(await sql("SELECT jsonb_build_object('transactionAt',CURRENT_TIMESTAMP,'ammanDate',(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE,'backend',pg_backend_pid());")),started,
  'Expected read-only errors recover without changing the parent fixture clock');
 return {sql,started,async close(){
  await tail;
  if(closed){await exited;return;}
  const finished=JSON.parse(await sql("SELECT jsonb_build_object('transactionAt',CURRENT_TIMESTAMP,'ammanDate',(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE,'backend',pg_backend_pid());"));
  try{assert.deepEqual(finished,started,'Every aging fixture/oracle shares one PostgreSQL clock and backend');}
  finally{child.stdin.end('COMMIT;\n\\q\n');await exited;stdout.close();stderr.close();}
  console.log(JSON.stringify({stage:'aging fixture clock preserved',...finished,passed:true}));
 }};
}
