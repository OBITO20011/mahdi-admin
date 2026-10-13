import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import type {UpdateMyProfileInput,UpdateMyProfileResult} from '../src/services/supabase/auth.service';

const input:UpdateMyProfileInput={fullName:' اسم الاختبار ',phone:' 0790000000 ',email:' new@example.invalid ',avatarUrl:'',language:'ar',timezone:' Asia/Amman ',address:' عنوان ',whatsapp:''};
type Call={name:string;args?:unknown};
function loadProfileService(options:{email?:string;unchanged?:boolean;failure?:'user'|'auth'|'rpc'|'evidence'}={}) {
  const calls:Call[]=[];
  const client={auth:{
    getUser:async()=>{calls.push({name:'getUser'});return {data:{user:options.failure==='user'?null:{id:'fixture',email:options.unchanged?'new@example.invalid':'old@example.invalid'}},error:null};},
    updateUser:async(args:unknown)=>{calls.push({name:'updateUser',args});return {data:{user:{id:'fixture',...(options.email===undefined?{}:{email:options.email})}},error:options.failure==='auth'?new Error('AUTH_FAILED'):null};}
  },rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:{success:options.failure!=='evidence'},error:options.failure==='rpc'?new Error('RPC_FAILED'):null};}};
  const serviceExports:{updateMyProfileInSupabase?:(value:UpdateMyProfileInput)=>Promise<UpdateMyProfileResult>}={};
  const source=readFileSync('src/services/supabase/auth.service.ts','utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{exports:serviceExports,require:(path:string)=>{
    assert.equal(path,'../../lib/supabase');return {supabase:client,isSupabaseConfigured:true};
  }});
  const save=serviceExports.updateMyProfileInSupabase;
  assert.ok(save);return {save,calls};
}

for(const fixture of [
  {name:'missing email',options:{},expected:null},
  {name:'empty email',options:{email:''},expected:null},
  {name:'old email returned',options:{email:'old@example.invalid'},expected:true},
  {name:'new email returned case-insensitive',options:{email:'NEW@example.invalid'},expected:false},
  {name:'unchanged email absent in response',options:{unchanged:true},expected:false},
] as const) test(`profile successful save: ${fixture.name}`,async()=>{
  const {save,calls}=loadProfileService(fixture.options);
  assert.deepEqual({...await save(input)},{emailConfirmationRequired:fixture.expected});
  assert.deepEqual(structuredClone(calls),[{name:'getUser'},
    {name:'updateUser',args:{...('unchanged' in fixture.options?{}:{email:'new@example.invalid'}),data:{language:'ar',timezone:'Asia/Amman',address:'عنوان',whatsapp:''}}},
    {name:'update_my_erp_profile',args:{p_full_name:'اسم الاختبار',p_phone:'0790000000',p_avatar_url:null}}]);
});
for(const failure of ['user','auth','rpc','evidence'] as const) test(`profile real failure remains rejected: ${failure}`,async()=>{
  const {save,calls}=loadProfileService({failure});
  await assert.rejects(save(input));
  assert.deepEqual(calls.map(call=>call.name),failure==='user'?['getUser']:failure==='auth'?['getUser','updateUser']:['getUser','updateUser','update_my_erp_profile']);
});

test('profile write guards/payloads and all calls retain f174307 except approved result/message',()=>{
  const printer=ts.createPrinter({removeComments:true});
  const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  for(const expected of [
    {file:'src/services/supabase/auth.service.ts',count:50,hash:'65bba6ccdbce90ad2c9269e7d22fdb7aa082c5f28921ecc3e34dc0b91a4ae9f9'},
    {file:'src/features/more/ProfileModal.tsx',count:196,hash:'74fff0ce0bd7a75bb6ea1efb9d4d397994e26758515a801eec5dcbb5faa43d44'},
  ]) {
    const ast=ts.createSourceFile(expected.file,readFileSync(expected.file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const calls:string[]=[];let normalizedMessages=0;let prefix:string|undefined;
    function visit(node:ts.Node) {
      if(ts.isCallExpression(node)) {
        const printed=printer.printNode(ts.EmitHint.Unspecified,node,ast);
        if(node.expression.getText(ast)==='setToast'&&node.arguments.length===1&&ts.isConditionalExpression(node.arguments[0])) {
          normalizedMessages++;calls.push('setToast(APPROVED_SUCCESS_MESSAGE)');
        } else calls.push(printed.replace('updatedEmail.toLocaleLowerCase()','authUpdateData.user.email.toLocaleLowerCase()'));
      }
      if(ts.isFunctionDeclaration(node)&&node.name?.text==='updateMyProfileInSupabase'&&node.body) {
        const statements=node.body.statements.filter(statement=>!ts.isReturnStatement(statement)&&!(ts.isVariableStatement(statement)&&statement.declarationList.declarations.some(declaration=>declaration.name.getText(ast)==='updatedEmail')));
        prefix=hash(statements.map(statement=>printer.printNode(ts.EmitHint.Unspecified,statement,ast)));
      }
      ts.forEachChild(node,visit);
    }
    visit(ast);assert.equal(calls.length,expected.count);assert.equal(hash(calls),expected.hash);
    if(expected.file.endsWith('auth.service.ts')) assert.equal(prefix,'bbb0a51989858799015bb210120bdd448e68a089054bc40122e620c6f68fc62a');
    else assert.equal(normalizedMessages,1);
  }
});
