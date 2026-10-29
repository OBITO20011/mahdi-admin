import test from 'node:test';
import assert from 'node:assert/strict';
import {exactMinorText,exactUnitCostText,formatExactMinorJod,formatExactUnitCostJod,parcelPacketQuantity} from '../src/utils/aftercare215Money';

test('215 decimal monetary text keeps exact large and negative amounts',()=>{
 assert.equal(formatExactMinorJod('9007199254740993'),'9,007,199,254,740.993 د.أ');
 assert.equal(formatExactMinorJod('-9007199254740993'),'−9,007,199,254,740.993 د.أ');
 assert.equal(formatExactMinorJod('0'),'0.000 د.أ');
 assert.equal(formatExactMinorJod('1500'),'1.500 د.أ');
 for(const input of [500,Number('9007199254740993'),null,undefined,'1.2','1e6','01','NaN'])assert.throws(()=>exactMinorText(input));
 assert.throws(()=>exactMinorText('-1'));assert.equal(exactMinorText('-1',true),'-1');
});
test('215 historical unit cost never rounds away fractional fils',()=>{
 assert.equal(formatExactUnitCostJod('1000.600000'),'1.0006 د.أ');
 assert.equal(formatExactUnitCostJod('0.600000'),'0.0006 د.أ');
 assert.equal(formatExactUnitCostJod('500.000000'),'0.500 د.أ');
 assert.equal(formatExactUnitCostJod('0.000001'),'0.000000001 د.أ');
 assert.equal(formatExactUnitCostJod('9007199254740993.123456'),'9,007,199,254,740.993123456 د.أ');
 for(const input of ['-1','1e3','1.1234567',1,null])assert.throws(()=>exactUnitCostText(input));
});
test('215 packet quantities use a supplied historical size; absence never guesses one',()=>{
 assert.equal(parcelPacketQuantity(14,12),'1 طرد + 2 باكيت');
 assert.equal(parcelPacketQuantity(12,12),'1 طرد');
 assert.equal(parcelPacketQuantity(14,null),'14 باكيت');
 assert.equal(parcelPacketQuantity(0,12),'0 باكيت');
 for(const q of [-1,0.5,Infinity])assert.throws(()=>parcelPacketQuantity(q,12));
 assert.throws(()=>parcelPacketQuantity(12,0));
});
