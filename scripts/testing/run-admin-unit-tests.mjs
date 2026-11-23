import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'../..');
const history='tests/product-workbook-history.test.ts';

// Git63 reconstructs and parses the entire historical application in a child
// process. Give that existing 120s proof its own batch instead of competing
// with hundreds of TypeScript test workers. Every test file still runs once.
export function adminUnitTestBatches(names){
 const files=names.filter(name=>name.endsWith('.test.ts')).sort().map(name=>{
  assert.equal(path.basename(name),name,'UNIT_TEST_PATH_INVALID');
  return 'tests/'+name;
 });
 assert.equal(new Set(files).size,files.length,'UNIT_TEST_FILE_DUPLICATE');
 assert.ok(files.includes(history),'UNIT_HISTORY_TEST_MISSING');
 const batches=[[history],files.filter(file=>file!==history)].filter(batch=>batch.length);
 assert.deepEqual(batches.flat().sort(),files,'UNIT_TEST_PARTITION_INCOMPLETE');
 return batches;
}

export async function runAdminUnitTests({names,run}={}){
 const batches=adminUnitTestBatches(names??await readdir(path.join(root,'tests')));
 const execute=run??(files=>spawnSync(process.execPath,['--import','tsx','--test',...files],{
  cwd:root,stdio:'inherit',windowsHide:true,
 }));
 for(const files of batches){
  const result=await execute(files);
  if(result.error)throw result.error;
  if(result.signal)throw Error('UNIT_TEST_PROCESS_SIGNAL:'+result.signal);
  assert.ok(Number.isInteger(result.status),'UNIT_TEST_EXIT_STATUS_MISSING');
  if(result.status!==0)return result.status;
 }
 return 0;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{assert.equal(process.argv.length,2,'UNIT_TEST_RUNNER_ARGUMENTS_UNSUPPORTED');process.exitCode=await runAdminUnitTests();}
 catch(error){console.error(error);process.exitCode=1;}
}
