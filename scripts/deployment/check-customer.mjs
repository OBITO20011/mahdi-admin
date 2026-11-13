// Read/build verification only. This command has no publication capability.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {assertProductionContext,assertDeploymentTarget} from '../environments/deployment-context.mjs';
import {verifyEnvironmentDist} from '../environments/verify-dist.mjs';

const root=path.resolve(import.meta.dirname,'../..');
function runNode(args,{cwd,env}) {
  const result=spawnSync(process.execPath,args,{cwd,env,stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;
  assert.equal(result.status,0,'CUSTOMER_CHECK_COMMAND_FAILED');
}

/**
 * @param {{args?:string[],env?:NodeJS.ProcessEnv,
 * run?:(args:string[],options:{cwd:string,env:NodeJS.ProcessEnv})=>void|Promise<void>,
 * verify?:(options:{app:'customer',environment:'production',dir:string})=>Promise<{ok:boolean,fixture:boolean}>}} [options]
 */
export async function checkCustomerProduction({args=[],env=process.env,run=runNode,verify=verifyEnvironmentDist}={}) {
  assert.ok(args.length===0||(args.length===1&&args[0]==='--check'),'CUSTOMER_CHECK_ARGUMENT_REFUSED');
  assertProductionContext(env);
  assertDeploymentTarget({app:'customer',environment:'production',branch:'main',project:'nawasrah-store'});
  const options={cwd:root,env:{...env,NAWASRAH_DEPLOYMENT_ENV:'production'}};
  // The existing context runner builds Vite + SEO and checks SEO output.
  await run([path.join(root,'scripts/environments/run-context.mjs'),'production','customer'],options);
  // Keep strict CSP, selected-project SEO and private-output checks unchanged.
  const dist=await verify({app:'customer',environment:'production',dir:path.join(root,'customer-web/dist')});
  assert.equal(dist.ok,true,'CUSTOMER_CHECK_DIST_FAILED');
  assert.equal(dist.fixture,false,'CUSTOMER_CHECK_FIXTURE_NOT_DEPLOYABLE');
  await run([path.join(root,'customer-web/scripts/verify-seo-output.mjs')],{...options,cwd:path.join(root,'customer-web')});
  return {ok:true,app:'customer',environment:'production',uploaded:false,dist};
}

if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){
  console.log(JSON.stringify(await checkCustomerProduction({args:process.argv.slice(2)})));
}
