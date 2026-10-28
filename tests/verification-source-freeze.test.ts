import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from '../scripts/testing/verification-source-freeze.mjs';
function fixture(){
 const root=mkdtempSync(path.join(tmpdir(),'nawasrah-source-freeze-'));
 execFileSync('git',['init','--quiet',root],{windowsHide:true});
 writeFileSync(path.join(root,'.gitignore'),'node_modules/\nignored.log\n.env.local\n');
 writeFileSync(path.join(root,'source.ts'),'export const amount=1000;\n');
 execFileSync('git',['add','.gitignore','source.ts'],{cwd:root,windowsHide:true});return root;
}
test('verification freeze detects same-path content edits even when Git status paths stay identical',async()=>{
 const root=fixture(),before=await readVerificationSourceFreeze(root);
 writeFileSync(path.join(root,'source.ts'),'export const amount=1001;\n');
 const after=await readVerificationSourceFreeze(root);assert.equal(after.fileCount,before.fileCount);
 assert.throws(()=>assertVerificationSourceFreeze(before,after),/REPOSITORY_CHANGED_DURING_VERIFICATION/);
});
test('verification freeze detects newly added and deleted source files',async()=>{
 const root=fixture(),before=await readVerificationSourceFreeze(root);
 writeFileSync(path.join(root,'new.ts'),'export const mode="return";\n');
 const added=await readVerificationSourceFreeze(root);assert.throws(()=>assertVerificationSourceFreeze(before,added),/REPOSITORY_CHANGED/);
 unlinkSync(path.join(root,'new.ts'));unlinkSync(path.join(root,'source.ts'));
 const deleted=await readVerificationSourceFreeze(root);assert.throws(()=>assertVerificationSourceFreeze(before,deleted),/REPOSITORY_CHANGED/);
});
test('verification freeze ignores dependency/runtime files and ignored credentials without reading them',async()=>{
 const root=fixture(),before=await readVerificationSourceFreeze(root);
 mkdirSync(path.join(root,'node_modules'));writeFileSync(path.join(root,'node_modules','runtime.log'),'temporary');
 writeFileSync(path.join(root,'ignored.log'),'temporary');writeFileSync(path.join(root,'.env.local'),'TEST_PLACEHOLDER_ONLY=example');
 const after=await readVerificationSourceFreeze(root);assertVerificationSourceFreeze(before,after);
 assert.equal(after.rows.some(row=>String(row[0]).includes('.env.local')),false);
});
