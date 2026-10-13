import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const baseline='f2c37bd0e4ebec9f525b426e66e67df66b36fdbe';
const files=[
  'src/features/crm/CustomerDetailView.tsx',
  'src/features/directReceiving/DirectReceivingView.tsx',
  'src/features/pos/posV2Cart.ts',
  'src/features/products/ProductFormModal.tsx',
  'src/features/purchases/CreatePurchaseOrderModal.tsx',
  'src/services/supabase/adminAssistant.service.ts',
  'src/services/supabase/crm.service.ts',
  'src/services/supabase/dashboard.service.ts',
  'src/services/supabase/directReceiving.service.ts',
  'src/services/supabase/orders.service.ts',
  'src/services/supabase/posV2.service.ts',
  'src/services/supabase/purchases.service.ts',
  'src/services/supabase/salesAftercare.service.ts',
  'src/services/supabase/stockAlerts.service.ts',
  'src/stores/useAppStore.ts',
];
const printer=ts.createPrinter({removeComments:true});
type AstTree=[number, string | AstTree[]];
function tree(node:ts.Node,ast:ts.SourceFile):AstTree {
  const children:AstTree[]=[];
  ts.forEachChild(node,child=>{children.push(tree(child,ast));});
  return [node.kind,children.length?children:node.getText(ast)];
}
function normalized(source:string,file:string) {
  const ast=ts.createSourceFile(file,source.replaceAll('\r\n','\n'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const transformed=ts.transform(ast,[context=>{
    const visit:ts.Visitor=node=>{
      if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>['client','loadedCustomer'].includes(d.name.getText(ast)))) {
        assert.equal(node.declarationList.declarations.length,1,'Alias must not hide other declarations');
        const declaration=node.declarationList.declarations[0];
        assert.equal(declaration.initializer?.getText(ast),declaration.name.getText(ast)==='client'?'supabase':'result.customer','Exact immutable identity alias only');
        assert.ok(node.declarationList.flags & ts.NodeFlags.Const,'Alias must be const');
        return undefined;
      }
      // The only additional branch is the assistant's unconfigured-client error;
      // its existing UI failure message is retained, and no invocation can occur.
      if(file.endsWith('adminAssistant.service.ts')&&ts.isIfStatement(node)&&node.expression.getText(ast)==='!supabase') {
        assert.equal(node.thenStatement.getText(ast).replace(/\s+/gu,' '),"{ throw new Error('تعذر التواصل مع المساعد الآن.'); }");
        return undefined;
      }
      if(ts.isIdentifier(node)&&node.text==='client')return ts.factory.createIdentifier('supabase');
      if(ts.isIdentifier(node)&&node.text==='loadedCustomer')return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('result'),'customer');
      return ts.visitEachChild(node,visit,context);
    };
    return root=>ts.visitNode(root,visit) as ts.SourceFile;
  }]);
  const printed=printer.printFile(transformed.transformed[0]);
  transformed.dispose();
  const js=ts.transpileModule(printed,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,removeComments:true}}).outputText;
  const emitted=ts.createSourceFile('emitted.js',js,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const calls:AstTree[]=[];
  function collect(node:ts.Node) {
    if(ts.isCallExpression(node))calls.push(tree(node,emitted));
    ts.forEachChild(node,collect);
  }
  collect(emitted);
  return {body:tree(emitted,emitted),calls};
}
for(const file of files)test(`strict product: all emitted calls, payloads, guards and bindings match baseline: ${file}`,()=>{
  const before=normalized(execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'}),file);
  const after=normalized(readFileSync(file,'utf8'),file);
  assert.deepEqual(after.calls,before.calls,'All calls, including nested callback bodies');
  assert.deepEqual(after.body,before.body,'All runtime AST nodes, not only selected RPCs');
});
