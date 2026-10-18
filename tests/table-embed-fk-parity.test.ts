import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {sourceBeforeUnitTerminology} from '../scripts/audit/source-before-unit-terminology.mjs';

// Full pre-change AST hashes captured BEFORE editing from204f1ed (same sources
// as the approved21c8bd4 audit),not learned from the transformed implementation.
const files=[
 ['orders','8306e24ef3ab4f267ddc61ecfa6fc72d2865efadc6f2ff17acf04acca26b0e3b',1],
 ['purchases','fea661a9a3b29cd7849f52bc53052bcc292430d934f0e442f7ec0d17f7ea48fe',3],
 ['directReceiving','1dc8833b5736af51f3f59841f5fab86ff19e2c3f0e3a1a456b66cf15f551c317',1],
] as const;
const hints=/!(?:order_items_product_id_fkey|purchase_order_items_product_id_fkey|purchase_receipt_items_purchase_receipt_id_fkey|supplier_receipts_received_by_fkey)/gu;
for(const [name,hash,count] of files)test(`only the approved explicit relationship hints change the ENTIRE AST:${name}`,async()=>{
 const file=`src/services/supabase/${name}.service.ts`,text=sourceBeforeUnitTerminology(file,await readFile(file,'utf8'))!;
 assert.equal([...text.matchAll(hints)].length,count);
 // Remove only the four named PostgREST hints BEFORE parsing,so the printer
 // retains original literal spelling/quote style instead of synthesizing every
 // literal with different quote formatting. The approved AST hashes stay fixed.
 const source=ts.createSourceFile(file,text.replace(hints,''),ts.ScriptTarget.Latest,true);
 const printed=ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed}).printFile(source);
 assert.equal(createHash('sha256').update(printed).digest('hex'),hash,'Calls/payloads/fields/filters/order/handlers must be unchanged');
});
