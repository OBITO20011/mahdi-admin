import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');
const group=process.argv[2];
assert.ok(['core','package-f'].includes(group),'Expected core or package-f');
function execute(command,args){
  const result=spawnSync(command,args,{cwd:root,env:{...process.env,NAWASRAH_BROWSER_GROUP:group},stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
const run=args=>execute(process.execPath,args);
// Derive the unchanged local quality pipeline instead of maintaining a second list.
const script=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).scripts.quality;
if(group==='core'){
  const commands=script.split(' && ');
  assert.equal(commands.pop(),'npm run test:e2e','The full browser gate must remain the final quality command');
  for(const command of commands){
    const args=command.split(' ');
    if(args.shift()==='npm'){
      if(process.platform==='win32')execute(process.env.ComSpec??'cmd.exe',['/d','/s','/c','npm.cmd',...args]);
      else execute('npm',args);
    }
    else{assert.ok(command.startsWith('node '),'Unknown quality command; review explicitly');run(command.split(' ').slice(1));}
  }
}else run(['scripts/testing/verify-browser-network-isolation.mjs']);
run(['node_modules/@playwright/test/cli.js','test','--config','playwright.ci.config.ts']);
