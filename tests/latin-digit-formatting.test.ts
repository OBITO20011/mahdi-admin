import test from 'node:test';
import assert from 'node:assert/strict';
import {formatJod as storeMoney} from '../customer-web/src/utils/money';
import {DISPLAY_LOCALE,latinDisplayDigits} from '../customer-web/src/utils/displayLocale';
import {formatJod,formatMinorUnits,formatUiDate} from '../src/components/ui/uiFormat';
import {buildReceiptShareText} from '../src/utils/receipt';
import {formatOwnerMessage} from '../supabase/functions/_shared/owner-telegram-format';
import ts from 'typescript';
import {readdirSync,readFileSync} from 'node:fs';
import {liteProductDescription} from '../customer-web/src/utils/liteProductPricing';
import type {CatalogProduct} from '../customer-web/src/types/catalog';
const nonLatin=/[٠-٩۰-۹]/u;

test('store money uses Latin digits,comma grouping and three fils decimals without changing its value rules',()=>{
 assert.equal(storeMoney(1_234_750),'1,234.750 د.أ');
 assert.equal(storeMoney(17_500),'17.500 د.أ');
 assert.equal(storeMoney(900),'0.900 د.أ');
 assert.equal(storeMoney(0),'0.000 د.أ');
 assert.equal(storeMoney(-1),'0.000 د.أ');
 assert.equal(storeMoney(Number.NaN),'0.000 د.أ');
 assert.equal(storeMoney(Number.POSITIVE_INFINITY),'0.000 د.أ');
 assert.equal(storeMoney(1_234_750.4),'1,234.750 د.أ');
});

test('the display policy preserves Arabic date wording and leading zeros in numeric labels',()=>{
 assert.equal(DISPLAY_LOCALE,'ar-JO-u-nu-latn');
 assert.equal((1234.75).toLocaleString(DISPLAY_LOCALE,{minimumFractionDigits:3}),'1,234.750');
 assert.equal(latinDisplayDigits('٠٠١٢٣٤ / ۰۱۲۳۴۵۶۷۸۹'),'001234 / 0123456789');
 assert.equal(latinDisplayDigits('001234'),'001234');
 assert.equal(latinDisplayDigits('باكيت'),'باكيت');
 const date=formatUiDate('2026-11-15T09:10:00Z',{year:'numeric',month:'long',day:'numeric'});
 assert.doesNotMatch(date,nonLatin);assert.match(date,/2026/);assert.match(date,/تشرين الثاني/);
});

test('existing exact admin money and Telegram output stay Latin without changing any database formatter',()=>{
 assert.equal(formatJod(1234.75),'1,234.750');
 assert.equal(formatMinorUnits(9007199254740993n),'9,007,199,254,740.993');
 const message=formatOwnerMessage({eventType:'new_order',payload:{orderNumber:'TEST-123',totalInMinorUnits:1234750,paymentMethod:'cash_on_delivery'}});
 assert.match(message,/1,234\.750 د\.أ/);assert.doesNotMatch(message,nonLatin);
});

test('receipt WhatsApp date and money are Latin while saved quantities and price snapshots remain unchanged',()=>{
 const input={businessName:'متجر الاختبار',branchName:'الفرع',invoiceNumber:'TEST-123',customerName:'زبون تجريبي',createdAt:'2026-11-15T09:10:00Z',items:[{productName:'منتج تجريبي',quantity:2,unit:'باكيت',totalPrice:17.5}],subtotal:17.5,discount:0,totalAmount:17.5,paymentMethod:'cash' as const,paidAmount:17.5,remainingAmount:0,changeDue:0};
 const original=structuredClone(input),text=buildReceiptShareText(input);
 assert.doesNotMatch(text,nonLatin);assert.match(text,/17\.500 د\.أ/);assert.match(text,/2 باكيت/);assert.match(text,/2026/);assert.deepEqual(input,original);
});

test('a numeric content description uses Latin display digits and leaves the saved text intact',()=>{
 const product={unitNameAr:'باكيت',quantityTracked:false,description:'٢٤ حبة'} as CatalogProduct;
 assert.equal(liteProductDescription(product),'باكيت فيه 24 حبة');assert.equal(product.description,'٢٤ حبة');
 assert.equal(liteProductDescription({...product,description:'۲۴ حبة'}),'باكيت فيه 24 حبة');
 assert.equal(liteProductDescription({...product,description:'وصف المنتج كما حُفظ'}),'وصف المنتج كما حُفظ');
});

function unsafeArabicLocaleCalls(source: string): string[] {
 const file=ts.createSourceFile('display.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),bad:string[]=[];
 const visit=(node:ts.Node)=>{
  if((ts.isCallExpression(node)||ts.isNewExpression(node))&&node.arguments?.length){
   const expression=node.expression.getText(file),isFormat=/\.toLocale(?:String|DateString|TimeString)$/u.test(expression)||/^Intl\.(?:NumberFormat|DateTimeFormat)$/u.test(expression);
   const locale=node.arguments[0],options=node.arguments[1];
   if(isFormat&&ts.isStringLiteralLike(locale)&&/^ar(?:-|$)/u.test(locale.text)&&!locale.text.includes('-nu-latn')){
    const explicit=options&&ts.isObjectLiteralExpression(options)&&options.properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(file)==='numberingSystem'&&ts.isStringLiteralLike(p.initializer)&&p.initializer.text==='latn');
    if(!explicit)bad.push(locale.text);
   }
  }
  ts.forEachChild(node,visit);
 };visit(file);return bad;
}

test('display locale regression gate rejects implicit Arabic digits and leaves parsers and date keys outside presentation policy',()=>{
 assert.deepEqual(unsafeArabicLocaleCalls("(1).toLocaleString('ar-JO');new Intl.NumberFormat('ar-EG');new Intl.DateTimeFormat('ar');"),['ar-JO','ar-EG','ar']);
 assert.deepEqual(unsafeArabicLocaleCalls("(1).toLocaleString('ar-JO-u-nu-latn');new Intl.NumberFormat('ar-JO',{numberingSystem:'latn'});new Intl.DateTimeFormat('en-CA');'أ'.toLocaleLowerCase('ar');"),[]);
 const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):/\.tsx?$/u.test(e.name)?[dir+'/'+e.name]:[]);
 const bad=[...walk('src'),...walk('customer-web/src'),...walk('supabase/functions')].flatMap(file=>unsafeArabicLocaleCalls(readFileSync(file,'utf8')).map(locale=>({file,locale})));
 assert.deepEqual(bad,[]);
});
