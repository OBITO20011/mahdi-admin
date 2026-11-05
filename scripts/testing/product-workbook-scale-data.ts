/** Deterministic fictional inputs only. No client, environment, filesystem or network. */
import {PRODUCT_WORKBOOK_COLUMNS as C, FLAVOR_WORKBOOK_COLUMNS as F, PRODUCT_WORKBOOK_NOTES} from '../../src/features/goLive/productWorkbook';
import {GO_LIVE_COLUMNS} from '../../src/features/goLive/goLiveImport';

export const SCALE_SEED = 0x5eed219;
export const SCALE_DATE = '2026-11-05';
export type ScaleCell = string | number;
export interface ScaleSheet {name:string; rows:ScaleCell[][]; widths?:number[]}
const arabic = (value:string) => value.replace(/[0-9]/gu, n => '٠١٢٣٤٥٦٧٨٩'[Number(n)]);
const money = (minor:number) => `${Math.floor(minor / 1000)}.${String(minor % 1000).padStart(3, '0')}`;
const cells = (columns:readonly {key:string}[], values:Record<string,ScaleCell>) => columns.map(c => values[c.key] ?? '');
const set = (row:ScaleCell[], columns:readonly {key:string}[], key:string, value:ScaleCell) => {
  const index = columns.findIndex(c => c.key === key);
  if (index < 0) throw Error('SCALE_UNKNOWN_COLUMN');
  row[index] = value;
};

export function productWorkbookScaleData() {
  let seed = SCALE_SEED;
  const next = () => {seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0;};
  const products:ScaleCell[][] = [C.map(c => c.header)];
  const flavors:ScaleCell[][] = [F.map(c => c.header)];
  const productSkus:string[] = [];
  let flavorIndex = 0;
  for (let i = 0; i < 1000; i++) {
    const family = i < 32;
    const sku = i === 700 ? 'SCALE-LONG-' + 'A'.repeat(53) : 'SCALE-' + String(i).padStart(4, '0');
    const inputSku = i % 17 === 0 ? arabic(sku) : sku;
    productSkus.push(inputSku);
    const method = ['طرد', 'باكيت مفرد', 'الاثنين'][i % 3];
    const purchaseSize = [6, 12, 24][next() % 3];
    const saleSize = method === 'باكيت مفرد' ? 1 : [6, 12, 24][next() % 3];
    const cost = 200 + (i % 19) * 25;
    const packet = cost + 200;
    const numeric = (n:number) => i % 19 === 0 ? arabic(String(n)) : String(n);
    const stock = !family && i % 4 !== 0 ? numeric(1 + i * 7 % 700) : '';
    const name = i === 700
      ? 'منتج وهمي طويل للاختبار فقط ' + 'شوكولاتة ومشروبات بالجملة '.repeat(4) + '< > & «عربي»'
      : `${family ? 'عائلة' : 'منتج'} اختبار حجم وهمي ${arabic(String(i))} < > &`;
    products.push(cells(C, {
      sku:inputSku, barcode:family ? '' : i === 100 ? 900000000100 : i === 701
        ? '000123456789012345678901234567890123' : '00' + String(10000000000000 + i),
      name_ar:i===33?'ﺑﺮﺍﻭﻧﻲ   وهمي':name, category_name:i % 2 ? 'مشروبات وهمية' : 'شوكولاتة',
      base_unit_name:'PKT', purchase_unit_name:'CTN', units_per_purchase_unit:numeric(purchaseSize),
      sale_unit_name:method === 'باكيت مفرد' ? 'PKT' : 'CTN', units_per_sale_unit:numeric(saleSize),
      sale_package_price:i % 19 === 0 ? arabic(money(packet * saleSize)) : money(packet * saleSize),
      purchase_package_price:money(cost * purchaseSize), cost_per_base_unit:money(cost), min_stock_level:'0',
      sale_method:method, packet_price:method === 'طرد' ? '' : money(packet),
      brand_name:i % 5 === 0 ? 'علامة اختبار حجم وهمية' : '',
      description:'بيانات اختبار حتمية، ليست بيانات محل أو زبون. ' + (i === 700 ? 'وصف عربي مع رموز < > &.' : ''),
      warehouse_code:'WH-MAIN', max_stock_level:'10000', opening_stock:stock,
    }));
    if (family) {
      const count = i < 30 ? i + 1 : i === 30 ? 5 : 10;
      for (let f = 0; f < count; f++, flavorIndex++) {
        flavors.push(cells(F, {
          master_sku:inputSku, name:flavorIndex===0?'ﺑﺮﺍﻭﻧﻲ   نكهة':`نكهة وهمية ${arabic(String(f + 1))} &`,
          barcode:flavorIndex === 479 ? 900000009999 : flavorIndex % 3 === 0 ? '' : '00088' + String(flavorIndex).padStart(8, '0'),
          sku:flavorIndex % 4 === 0 ? 'FLAVOR-' + String(flavorIndex).padStart(4, '0') : '',
          opening_stock:flavorIndex % 2 === 0 ? String(1 + flavorIndex * 7 % 700) : '',
        }));
      }
    }
  }
  const instructions:ScaleSheet = {name:'تعليمات ومراجعة', rows:[
    ['ملف وهمي لاختبار الحجم فقط؛ لا يُستورد في فرانكفورت أو المعاينة.'],
    ['1000 منتج أساسي، منها 32 عائلة و480 نكهة؛ seed ثابت ' + SCALE_SEED],
    ...PRODUCT_WORKBOOK_NOTES.map(note => [note]),
    ['الأرقام المحفوظة كأرقام حالات اختبار مقصودة؛ لا نفترض إعادة الأصفار التي ضاعت قبل القراءة.'],
  ], widths:[120]};
  const positive:ScaleSheet[] = [{name:'المنتجات', rows:products, widths:C.map(c => c.width ?? 26)},
    {name:'النكهات', rows:flavors, widths:F.map(c => c.width ?? 26)}, instructions];
  const negative = structuredClone(positive);
  const p = negative[0].rows, f = negative[1].rows;
  const duplicateBarcode = String(f[2][F.findIndex(c => c.key === 'barcode')]);
  set(p[33], C, 'barcode', duplicateBarcode);
  set(f[480], F, 'master_sku', 'NO-SUCH-MASTER');
  set(p[36], C, 'packet_price', '');
  set(p[39], C, 'packet_price', '99.999');
  set(f[5], F, 'name', String(f[4][F.findIndex(c => c.key === 'name')]));
  set(f[5], F, 'sku', 'SCALE-NEG-UNIQUE-SKU');
  f.push(cells(F, {master_sku:productSkus[29], name:'نكهة إضافية سلبية', barcode:'NEG-EXTRA-31', sku:'SCALE-NEG-EXTRA-31'}));
  set(p[6], C, 'barcode', 'NEG-MASTER-0001');
  const faults = [
    {id:'cross-sheet-barcode', sheet:'المنتجات', row:34, column:'barcode', reason:'مكرر عبر ورقتي'},
    {id:'missing-master', sheet:'النكهات', row:481, column:'master_sku', reason:'رمز المنتج الأساسي غير موجود'},
    {id:'missing-packet-price', sheet:'المنتجات', row:37, column:'packet_price', reason:'سعر بيع الباكيت المفرد مطلوب'},
    {id:'packet-parcel-mismatch', sheet:'المنتجات', row:40, column:'packet_price', reason:'سعر الباكيت لا يطابق'},
    {id:'duplicate-flavor-name', sheet:'النكهات', row:6, column:'name', reason:'اسم نكهة مكرر'},
    {id:'over-30-flavors', sheet:'المنتجات', row:31, column:'flavors', reason:'الحد الأعلى 30 نكهة'},
    {id:'master-barcode', sheet:'المنتجات', row:7, column:'barcode', reason:'المنتج الأساسي للنكهات بلا باركود'},
  ];
  const ancillary:Record<string,ScaleSheet[]> = {
    'ديون-العملاء.xlsx':[{name:'البيانات', rows:[GO_LIVE_COLUMNS.customers.map(c => c.header),
      cells(GO_LIVE_COLUMNS.customers, {customer_name:'ﺑﺮﺍﻭﻧﻲ   عميل وهمي', customer_phone:'0790000000', amount:'1.000', original_date:SCALE_DATE, notes:'وهمي فقط'})]}],
    'أرصدة-الموردين.xlsx':[{name:'البيانات', rows:[GO_LIVE_COLUMNS.suppliers.map(c => c.header),
      cells(GO_LIVE_COLUMNS.suppliers, {supplier_name:'ﺑﺮﺍﻭﻧﻲ   مورد وهمي', supplier_phone:'0780000000', direction:'له', amount:'2.000', original_date:SCALE_DATE, notes:'وهمي فقط'})]}],
    'الدرج-الافتتاحي.xlsx':[{name:'البيانات', rows:[['العهدة الافتتاحية (د.أ)'], ['3.000']]}],
  };
  const reference = {format:1, asOf:SCALE_DATE,
    categories:[{name:'شوكولاتة', active:true}, {name:'مشروبات وهمية', active:true}],
    units:[{code:'PKT', name:'باكيت'}, {code:'CTN', name:'طرد'}],
    brands:[{name:'علامة اختبار حجم وهمية', active:true}], warehouses:[{code:'WH-MAIN', active:true}],
    products:[], customers:[], suppliers:[], chequeKeys:[],
  };
  return {seed:SCALE_SEED, date:SCALE_DATE, positive, negative, faults, ancillary, reference,
    expected:{parents:1000, families:32, flavors:480, totalProducts:1480, stockable:1448, missingStock:482, filledStock:966},
    numericIdentifiers:[{sheet:'المنتجات', row:102, column:'barcode'}, {sheet:'النكهات', row:481, column:'barcode'}]};
}
