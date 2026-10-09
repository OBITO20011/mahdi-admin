import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {formatItemCount} from '../src/components/ui/uiFormat';
import {buildSideNavigation,SIDE_NAV_MORE} from '../src/components/layout/sideNavigationModel';

test('cashier item count follows the owner-approved Arabic forms without changing quantity',()=>{
  for(const [count,label] of [[0,'لا أصناف'],[1,'صنف واحد'],[2,'صنفان'],[3,'3 أصناف'],[10,'10 أصناف'],[11,'11 صنفاً'],[100,'100 صنفاً']] as const) assert.equal(formatItemCount(count),label);
});
test('every canonical rail item has an explicit short label and retains its full name/action',()=>{
  const items=[...buildSideNavigation('owner').flatMap(g=>g.items),SIDE_NAV_MORE];
  for(const item of items) {assert.ok(item.railLabel);assert.ok(item.railLabel.length<=9);assert.ok(item.label);assert.ok(item.action.destination);}
  assert.equal(items.find(i=>i.id==='admin-users')?.railLabel,'الفريق');
  assert.equal(items.find(i=>i.id==='sales-pos')?.railLabel,'بيع');
  const source=readFileSync('src/components/layout/SideNav.tsx','utf8');
  assert.match(source,/title=\{collapsed \? item.label : undefined\}/u);
  assert.match(source,/aria-label=\{collapsed \? item.label : undefined\}/u);
  assert.match(source,/\{item.railLabel\}/u);
  assert.doesNotMatch(source,/item.label.split/u);
});
test('Inventory and POS business-call traces match the independently captured faae71a baseline',()=>{
  const expected=[
    ['src/features/inventory/InventoryView.tsx',7,'4da034eb73cac13709856a2738c4012cfe9140ca84f7402a995c22d7f6c8ffee'],
    ['src/features/pos/PosView.tsx',31,'f866461b5707840a1500c21bc9d40af82030f249485b1c174910a4daf3c53087'],
    ['src/features/pos/PosParcelBuilder.tsx',0,'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'],
  ] as const;
  const printer=ts.createPrinter({removeComments:true});
  for(const [file,count,hash] of expected){
    const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),calls:string[]=[];
    function visit(node:ts.Node){
      if(ts.isAwaitExpression(node)||ts.isCallExpression(node)&&/(?:FromSupabase|Service|\.rpc$|^run[A-Z]|^openModal$|^fetchProductPage$)/u.test(node.expression.getText(ast))) calls.push(printer.printNode(ts.EmitHint.Unspecified,node,ast));
      ts.forEachChild(node,visit);
    }
    visit(ast);assert.equal(calls.length,count,file);assert.equal(createHash('sha256').update(JSON.stringify(calls.sort())).digest('hex'),hash,file);
  }
});
test('inventory presentation preserves server-wide facts, scope and all existing mutation destinations',()=>{
  const source=readFileSync('src/features/inventory/InventoryView.tsx','utf8');
  assert.doesNotMatch(source,/(?:bg|text|border)-(?:slate|blue|gray|indigo|rose|amber|emerald)-\d/u);
  for(const fact of ['totalCostValue','totalItems','activeItems','availableStock','lowStock','outOfStock']) assert.ok(source.includes('inventoryProductPage.metrics.'+fact));
  assert.match(source,/label="أصناف نشطة".*value=\{kpi\(activeItemCount\)\}/u);
  assert.match(source,/value:'available',label:'متوفر',count:availableStockCount/u);
  assert.doesNotMatch(source,/filteredProducts.reduce|costPrice \*/u);
  for(const contract of ["status: statusFilter","pageSize: 24","warehouseId: selectedWarehouseId === 'all'","productId: historyProductId","openModal('receive_goods')","openModal('stock_count', { productId: product.id })","openModal('inventory_opening_setup')",'ClearInventoryBalanceDialog','setClearInventoryProduct(product)','acceptedRevision !== productDataRevision','preventScroll:true']) assert.ok(source.includes(contract),contract);
});
