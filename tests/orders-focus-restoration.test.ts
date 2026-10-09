import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

test('Orders focus correction preserves every e122ad6 business call and input-value callback', () => {
  const file = 'src/features/orders/OrdersCenterView.tsx';
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const printer = ts.createPrinter({ removeComments: true });
  const calls: string[] = [], changes: string[] = [];
  const hash = (values: string[]) => createHash('sha256').update(JSON.stringify(values.sort())).digest('hex');
  function visit(node: ts.Node) {
    if (ts.isAwaitExpression(node) || ts.isCallExpression(node) && /(?:FromSupabase|Service|\.rpc$|^run[A-Z]|^openModal$)/u.test(node.expression.getText(ast))) {
      calls.push(printer.printNode(ts.EmitHint.Unspecified, node, ast));
    }
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onChange' && node.initializer) {
      changes.push(printer.printNode(ts.EmitHint.Unspecified, node.initializer, ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(calls.length, 6);
  assert.equal(hash(calls), '638c25e8fb757ecd19426b9dca3fb031301867e0056e6d89017cfc891be786dc');
  assert.equal(changes.length, 3);
  assert.equal(hash(changes), '6f6156ac762e5b37e555b84d4d6e616d906448e26613530e182eb26828d91bf9');
});
