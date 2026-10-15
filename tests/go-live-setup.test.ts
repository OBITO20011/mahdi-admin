import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {columnIndex, columnName, createZip, crc32, readXlsxFirstSheet, writeXlsx, XlsxError} from '../src/lib/xlsx.ts';
import {
  GO_LIVE_COLUMNS, mapServerErrors, mapSheet, parseDate, parseDirection, parseJodToMinor, prepareCustomers,
  prepareProducts, prepareStock, prepareSuppliers, templateRows, type StockProductRef,
} from '../src/features/goLive/goLiveImport.ts';
import {futureMigrationViolations} from '../scripts/testing/maintenance-db-contract.mjs';

const migrations = ['160_go_live_setup_foundation.sql', '161_go_live_customer_opening_balances.sql',
  '162_go_live_supplier_opening_balances.sql', '163_go_live_unified_collection_and_supplier_opening_payment.sql',
  '164_go_live_receivables_in_reports.sql'].map(name => [name, readFileSync(`supabase/migrations/${name}`, 'utf8')] as const);

test('crc32 and stored zip round-trip through the xlsx reader', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const rows = [['رمز الصنف SKU', 'الباركود'], ['CHO-001', '0062810000017'], ['', 'خلية & <نص>']];
  const parsed = await readXlsxFirstSheet(writeXlsx([{name: 'البيانات', rows}]));
  assert.deepEqual(parsed, rows.map(row => row.map(cell => cell.trim())));
});

test('reader handles shared strings, numbers, sparse cells and deflated entries', async () => {
  const encoder = new TextEncoder();
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>'
    + '<row r="3"><c r="A3"><v>6281000000017</v></c><c r="B3"><v>0.30000000000000004</v></c><c r="C3" t="b"><v>1</v></c>'
    + '<c r="D3" t="str"><v>a&amp;b</v></c></row></sheetData></worksheet>';
  const shared = '<sst><si><t>هاتف العميل</t></si><si><r><t>مبلغ </t></r><r><t xml:space="preserve">الدين</t></r></si></sst>';
  const deflate = async (text: string) => new Uint8Array(await new Response(new Blob([encoder.encode(text)]).stream()
    .pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const zip = createZip([
    {name: 'xl/workbook.xml', data: encoder.encode('<workbook><sheets><sheet name="a" sheetId="1" r:id="rId9"/></sheets></workbook>')},
    {name: 'xl/_rels/workbook.xml.rels', data: encoder.encode('<Relationships><Relationship Id="rId9" Target="worksheets/data.xml"/></Relationships>')},
    {name: 'xl/sharedStrings.xml', data: encoder.encode(shared)},
    {name: 'xl/worksheets/data.xml', data: encoder.encode(sheet), deflated: await deflate(sheet)},
  ]);
  assert.equal(new DataView(zip.buffer).getUint16(8, true), 0, 'first entry stored');
  const rows = await readXlsxFirstSheet(zip);
  assert.deepEqual(rows, [['هاتف العميل', '', 'مبلغ الدين'], [], ['6281000000017', '0.3', 'TRUE', 'a&b']]);
});

test('reader rejects non-xlsx input with an Arabic message', async () => {
  await assert.rejects(() => readXlsxFirstSheet(new TextEncoder().encode('a,b\n1,2')), (error: unknown) =>
    error instanceof XlsxError && /ليس بصيغة Excel/u.test(error.message));
  assert.equal(columnIndex('A1'), 0); assert.equal(columnIndex('AB7'), 27); assert.equal(columnName(27), 'AB');
});

test('money, dates and directions parse exactly without floating point', () => {
  assert.equal(parseJodToMinor('12.5'), '12500');
  assert.equal(parseJodToMinor('1,250.125'), '1250125');
  assert.equal(parseJodToMinor('٣٫٢٥'), '3250');
  assert.equal(parseJodToMinor('0.0001'), null);
  assert.equal(parseJodToMinor('-5'), null);
  assert.equal(parseJodToMinor('1e3'), null);
  assert.equal(parseDate('2025-03-15'), '2025-03-15');
  assert.equal(parseDate('15/3/2025'), '2025-03-15');
  assert.equal(parseDate('45731'), '2025-03-15');
  assert.equal(parseDate('2025-02-30'), null);
  assert.equal(parseDirection(' له '), 'payable');
  assert.equal(parseDirection('عليه'), 'advance');
  assert.equal(parseDirection('دين'), null);
});

test('templates and header mapping are exact; missing required headers are file errors', () => {
  for (const kind of ['products', 'stock', 'customers', 'suppliers'] as const) {
    const [header, example] = templateRows(kind);
    assert.equal(header.length, GO_LIVE_COLUMNS[kind].length);
    assert.equal(example.length, header.length);
    const mapped = mapSheet(kind, [header, example, ['', '']]);
    assert.deepEqual(mapped.fileErrors, []);
    assert.equal(mapped.rows.length, 1);
    assert.equal(mapped.rows[0].row, 2);
  }
  const missing = mapSheet('customers', [['هاتف العميل'], ['0790000000']]);
  assert.match(missing.fileErrors.join(' '), /مبلغ الدين/u);
  assert.match(mapSheet('suppliers', [templateRows('suppliers')[0]]).fileErrors[0], /لا يحتوي أي سطر/u);
});

test('row validation reports Arabic messages against original sheet rows', () => {
  const customers = mapSheet('customers', [templateRows('customers')[0],
    ['0790000001', 'أ', '10.5', '2025-01-01', ''], ['0790000002', 'ب', '0', '2025-01-01', ''],
    ['0790000003', 'ج', '5', '2099-01-01', ''], ['0790000004', 'د', '5', 'غداً', '']]);
  const prepared = prepareCustomers(customers.rows, '2026-10-15');
  assert.deepEqual(prepared.payload.map(row => [row.sourceRow, row.amount_in_minor_units]), [[2, '10500']]);
  assert.deepEqual(prepared.errors.map(error => error.row), [3, 4, 5]);
  assert.match(prepared.errors[1].message, /المستقبل/u);

  const suppliers = prepareSuppliers(mapSheet('suppliers', [templateRows('suppliers')[0],
    ['مورد أ', '', 'له', '100', '2025-01-01', ''], ['مورد أ', '', 'عليه', '5', '2025-01-01', ''],
    ['مورد ب', '078 000 0001', 'x', '5', '2025-01-01', '']]).rows, '2026-10-15');
  assert.deepEqual(suppliers.payload.map(row => row.direction), ['payable']);
  assert.match(suppliers.errors[0].message, /مكرر/u); assert.match(suppliers.errors[1].message, /له.*عليه/u);

  const products = prepareProducts(mapSheet('products', [templateRows('products')[0], templateRows('products')[1],
    templateRows('products')[1]]).rows);
  assert.equal(products.payload.length, 1);
  assert.equal(products.payload[0].sale_package_price_in_minor_units, '6000');
  assert.equal(products.payload[0].cost_per_base_unit_in_minor_units, '200');
  assert.match(products.errors[0].message, /مكرر داخل الملف \(السطر 2\)/u);
});

test('opening stock matches barcode/SKU, packages and loose units, and flavor masters are not stockable', () => {
  const products: StockProductRef[] = [
    {productId: 'p1', sku: 'CHO-1', barcode: '6281', productName: 'شوكولاتة', unitsPerPackage: 24, eligible: true, costPriceInMinorUnits: 50},
    {productId: 'p2', sku: 'FL-A', barcode: '6282', productName: 'نكهة أ', unitsPerPackage: 5, eligible: true, costPriceInMinorUnits: 0},
    {productId: 'p3', sku: 'OLD', productName: 'قديم', unitsPerPackage: 1, eligible: false, blockReason: 'بدأت حركات هذا الصنف.', costPriceInMinorUnits: 9},
  ];
  const sheet = mapSheet('stock', [templateRows('stock')[0], ['6281', '', '3', '5'], ['FL-A', '', '1', ''],
    ['MASTER', '', '1', ''], ['old', '', '1', ''], ['cho-1', '', '1', '24'], ['CHO-1', '', '0', '1']]);
  const prepared = prepareStock(sheet.rows, products);
  assert.deepEqual(prepared.payload.map(row => [row.productId, row.baseQuantity]), [['p1', 77]]);
  const expected: [number, string][] = [[3, 'أدخل تكلفة الشراء'], [4, 'لا يوجد صنف قابل للجرد'],
    [5, 'بدأت حركات هذا الصنف'], [6, 'الحبات الإضافية يجب'], [7, 'الصنف مكرر داخل الملف']];
  assert.deepEqual(prepared.errors.map(error => error.row), expected.map(([row]) => row));
  prepared.errors.forEach((error, index) => assert.ok(error.message.startsWith(expected[index][1]), error.message));
  assert.deepEqual(mapServerErrors([{sourceRow: 9}, {sourceRow: 12}], [{row: 2, message: 'x'}]), [{row: 12, message: 'x'}]);
});

test('migrations 160+ are explicit, definer-safe and keep every new table closed to clients', () => {
  for (const [name, sql] of migrations) {
    assert.deepEqual(futureMigrationViolations(sql), [], name);
    assert.match(sql, /^BEGIN;/u, name); assert.match(sql.trimEnd(), /COMMIT;$/u, name);
    const definitions = [...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION (public\.\w+)\(/gu)].map(match => match[1]);
    for (const fn of definitions) {
      const body = sql.slice(sql.indexOf(fn + '('));
      const header = body.slice(0, body.indexOf('AS $$'));
      assert.match(header, /SECURITY DEFINER/u, fn);
      assert.match(header, /SET search_path ?= ?public, ?pg_temp/u, fn);
      assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${fn.replace('.', '\\.')}\\(`, 'u'), fn);
    }
    for (const table of [...sql.matchAll(/CREATE TABLE (public\.\w+)/gu)].map(match => match[1])) {
      assert.match(sql, new RegExp(`ALTER TABLE ${table.replace('.', '\\.')} ENABLE ROW LEVEL SECURITY`, 'u'), table);
      assert.match(sql, new RegExp(`REVOKE ALL ON TABLE ${table.replace('.', '\\.')} FROM PUBLIC, anon, authenticated`, 'u'), table);
    }
  }
  const all = migrations.map(([, sql]) => sql).join('\n');
  for (const writer of ['import_go_live_products_v1', 'record_customer_opening_balances_v1', 'reverse_customer_opening_balance_v1',
    'record_supplier_opening_balances_v1', 'reverse_supplier_opening_balance_v1', 'finish_go_live_setup_v1', 'get_go_live_setup_status_v1']) {
    const body = all.slice(all.indexOf(`FUNCTION public.${writer}(`));
    assert.match(body.slice(0, body.indexOf('$$;')), /assert_erp_role\(ARRAY\['owner'\]/u, writer);
  }
  // Opening debt never touches sales, payments, shifts or stock tables.
  const customer = migrations[1][1];
  assert.doesNotMatch(customer, /INSERT INTO public\.(orders|order_items|customer_payments|cash_shifts|inventory_\w+)/u);
});
