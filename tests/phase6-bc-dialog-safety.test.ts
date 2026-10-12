import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path: string) => readFileSync(path, 'utf8');
test('both standalone dialog implementations run the identical behavioral safety contract', () => {
  const spec=read('e2e/dialog-focus-contract.spec.ts');
  const contract=read('e2e/helpers/dialog-focus-contract.ts');
  assert.match(spec,/registerDialogFocusContract\('Admin','http:\/\/127\.0\.0\.1:4173'\)/u);
  assert.match(spec,/registerDialogFocusContract\('Customer',process\.env\.CUSTOMER_BASE_URL\?\?'http:\/\/127\.0\.0\.1:4174'\)/u);
  assert.equal((spec.match(/registerDialogFocusContract\(/gu)||[]).length,2);
  for(const behavior of ['Tab wraps both directions','nested dialog owns Tab',
    'Escape closes only the top dialog','ordinary close restores the external opener',
    'programmatic focus cannot reach a lower dialog']) assert.ok(contract.includes(behavior),behavior);
  assert.doesNotMatch(contract,/if\s*\(\s*name\s*===|test\.skip|test\.fixme|waitForTimeout/u);
  assert.match(contract,/const path='\/src\/utils\/dialogFocus\.ts'/u);
  assert.doesNotMatch(read('customer-web/src/hooks/useDialogFocus.ts'), /\.\.\/\.\.\/\.\.\/src/u);
  for (const name of ['GuidedStoreAssistant', 'OrderTrackingModal']) {
    const source = read(`customer-web/src/components/${name}.tsx`);
    assert.match(source, /useDialogFocus\(isOpen/u);
    assert.doesNotMatch(source, /addEventListener\('keydown'/u);
  }
});

test('submitting forms own a finally cleanup instead of only clearing busy after a successful await', () => {
  const paths = [
    'src/features/directReceiving/RecordSupplierPaymentModal.tsx',
    'src/features/directReceiving/CreateDirectReceiptModal.tsx',
    'src/features/directReceiving/CancelSupplierReceiptDialog.tsx',
    'src/features/accounts/RecordCustomerPaymentModal.tsx',
    'src/features/crm/AddCustomerModalContent.tsx',
    'src/features/crm/AddAddressModal.tsx',
    'src/features/crm/CustomerEditModal.tsx',
    'src/features/inventory/StockCountModal.tsx',
    'src/features/inventory/ClearInventoryBalanceDialog.tsx',
    'src/features/products/StockAdjustmentModal.tsx',
    'src/features/expenses/ExpenseFormModal.tsx',
    'src/features/purchases/CreateSupplierModal.tsx',
    'src/features/purchases/CreatePurchaseOrderModal.tsx',
    'src/features/purchases/SupplierPaymentModal.tsx',
    'src/features/purchases/ReceiveGoodsModal.tsx',
  ];
  let checked = 0;
  for (const path of paths) {
    const source = read(path);
    assert.match(source, /aria-busy=/u, path);
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isArrowFunction(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
        && ts.isBlock(node.body)) {
        const setters = node.body.statements.filter(statement => ts.isExpressionStatement(statement)
          && ts.isCallExpression(statement.expression)
          && /^set(IsSubmitting|IsSaving|Saving|Loading)$/u.test(statement.expression.expression.getText(ast))
          && statement.expression.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword);
        for (const setter of setters) {
          const name = (setter as ts.ExpressionStatement).expression as ts.CallExpression;
          const setterName = name.expression.getText(ast);
          const cleanup = node.body.statements.some(statement => ts.isTryStatement(statement)
            && statement.finallyBlock?.getText(ast).includes(`${setterName}(false)`));
          assert.equal(cleanup, true, `${path}: ${setterName} needs finally`);
          checked++;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  assert.equal(checked, paths.length);
});
