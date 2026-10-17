import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

test('Frankfurt VAPID rotation changes only the approved public point,not subscription behavior',()=>{
 const name='src/services/pushNotifications.service.ts';
 const before=execFileSync('git',['show',`6a9b9d2:${name}`],{encoding:'utf8'}).replaceAll('\r\n','\n');
 const after=readFileSync(name,'utf8').replaceAll('\r\n','\n');
 // Public P-256 point,not a credential;the private half is never read here.
 const publicPoint='BIN48kQzsXJS2nOOoFkpJlut6nzzyKplxdDermEoKg3yybH8uAV49xqxkIAYin6DugySG3ucwci2JEW5PUw40AU';
 const point=Buffer.from(publicPoint,'base64url');assert.equal(point.length,65);assert.equal(point[0],4);
 const assignment=/const WEB_PUSH_PUBLIC_KEY =\s*'([^']+)';/u;
 assert.equal(assignment.exec(after)?.[1],publicPoint);
 assert.equal(after.replace(assignment,'const WEB_PUSH_PUBLIC_KEY = "PUBLIC_POINT";'),before.replace(assignment,'const WEB_PUSH_PUBLIC_KEY = "PUBLIC_POINT";'));
 const emit=(text:string)=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 assert.equal(emit(after).replace(publicPoint,'PUBLIC_POINT'),emit(before).replace(assignment.exec(before)![1],'PUBLIC_POINT'));
});
