import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';

// Class-only correction: all calls, payloads, checks, confirmations, input
// callbacks and focus/scroll logic stay identical to the approved 8195f87 source.
for(const [file,baseline] of [
 ['src/features/orders/OrdersCenterView.tsx','930d20a1c5762dad0f064be6c9da000dca97ae148bf45fdb639aab6d7943e42f'],
 ['src/features/orders/OrderDetailModal.tsx','91bf0c6517bd6c2a8ea9cd5dae7c8b7dc010505822f35c2da85a82d2a5cc83d9'],
])test(`${file}: Orders panel changes only className`,()=>{
 const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const transformed=ts.transform(ast,[context=>root=>{
  function visit(node:ts.Node):ts.Node{
   if(ts.isJsxAttributes(node))return ts.factory.updateJsxAttributes(node,node.properties.filter(attribute=>!ts.isJsxAttribute(attribute)||attribute.name.getText(ast)!=='className'));
   return ts.visitEachChild(node,visit,context);
  }
  return ts.visitNode(root,visit) as ts.SourceFile;
 }]);
 const normalized=ts.createPrinter({removeComments:true}).printFile(transformed.transformed[0]);transformed.dispose();
 assert.equal(createHash('sha256').update(normalized).digest('hex'),baseline);
});
