import test from 'node:test';import assert from 'node:assert/strict';
import {sanitizeEvent,sanitizeBreadcrumb} from '../src/lib/monitoringPrivacy';
import {sanitizeEvent as storeSanitize} from '../customer-web/src/lib/monitoringPrivacy';
import {monitoringEnvironment,resolveBuildEnvironment,renderEnvironmentHeaders} from '../scripts/environments/environment.mjs';
import {readFileSync} from 'node:fs';
test('both sanitizers drop arbitrary PII,money,input,cart,headers,query,breadcrumbs and contexts',()=>{
 for(const sanitize of [sanitizeEvent,storeSanitize]){
 const raw={type:undefined,release:'secret',environment:'secret',event_id:'secret',message:'زبون سري 0771234567 100.500',user:{email:'secret@example.test'},extra:{cart:'secret',token:'secret'},request:{url:'https://example.test/customer/secret?token=secret'},contexts:{react:{componentStack:'secret'}},breadcrumbs:[{message:'secret'}],exception:{values:[{value:'secret',stacktrace:{frames:[{filename:'secret'}]}}]}};
 const safe=JSON.stringify(sanitize(raw));for(const secret of ['سري','0771234567','100.500','secret','cart','token'])assert.ok(!safe.includes(secret),secret);
 assert.equal(JSON.parse(safe).message,'FRONTEND_ERROR');assert.equal(sanitizeBreadcrumb({message:'secret'}),null);
 }
});
test('DSN is explicitly selected by environment,missing is off,and isolated discards every DSN',()=>{
 const dsn='https://publickey@o123.ingest.de.sentry.io/456';
 const env={VITE_SENTRY_DSN_PRODUCTION:dsn};assert.equal(monitoringEnvironment(env,'production').dsn,dsn);assert.equal(monitoringEnvironment(env,'staging').dsn,'');assert.equal(monitoringEnvironment(env,'isolated').dsn,'');
 assert.throws(()=>monitoringEnvironment({...env,VITE_SENTRY_DSN_STAGING:dsn},'production'),/MONITORING_DSN_REUSED/u);
 assert.throws(()=>monitoringEnvironment({VITE_SENTRY_DSN_STAGING:'https://evil.test/1'},'staging'),/MONITORING_DSN_INVALID/);
 const template=readFileSync('public/_headers','utf8');const config=resolveBuildEnvironment({...env,NAWASRAH_DEPLOYMENT_ENV:'production'});assert.ok(renderEnvironmentHeaders(template,config).includes('https://o123.ingest.de.sentry.io;'));assert.ok(!renderEnvironmentHeaders(template,resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:'staging'})).includes('sentry.io'));
});


test('dist verification reads the same per-context local env file as Vite without mixing contexts',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {loadVerificationEnvironment}=await import('../scripts/environments/verify-dist.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'nawasrah-monitoring-env-')),dsn='https://fixture@o123.ingest.de.sentry.io/999',key='VITE_SENTRY_DSN_STAGING',saved=process.env[key];
 delete process.env[key];
 try{
  await writeFile(path.join(root,'.env.staging.local'),key+'='+dsn+'\n');
  assert.equal(loadVerificationEnvironment('staging',root).monitoring.dsn,dsn);
  assert.equal(loadVerificationEnvironment('production',root).monitoring.dsn,'');
  process.env[key]='https://fixture@o123.ingest.de.sentry.io/998';
  assert.equal(loadVerificationEnvironment('staging',root).monitoring.dsn,process.env[key],'Process values retain Vite precedence');
 }finally{if(saved===undefined)delete process.env[key];else process.env[key]=saved;await rm(root,{recursive:true,force:true});}
});
