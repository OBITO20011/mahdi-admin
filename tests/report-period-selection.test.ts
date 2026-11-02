import test from 'node:test';import assert from 'node:assert/strict';import{reportToday,readReportPeriod}from'../src/utils/reportPeriodSelection';
test('initial report is one Amman calendar day across UTC midnight/year boundaries',()=>{
 for(const [utc,day]of[['2026-11-02T20:59:59Z','2026-11-02'],['2026-11-02T21:00:00Z','2026-11-03'],['2026-12-31T22:00:00Z','2027-01-01']]){assert.equal(reportToday(new Date(utc)),day);assert.deepEqual(readReportPeriod(new Date(utc),null),{dateFrom:day,dateTo:day});}
});
test('explicit session range survives reopen;corrupt/reversed/invalid storage safely defaults to today',()=>{
 const now=new Date('2026-11-02T22:30:00Z');const range={dateFrom:'2026-10-01',dateTo:'2026-10-15'};assert.deepEqual(readReportPeriod(now,{getItem:()=>JSON.stringify(range)}),range);
 for(const raw of ['invalid','null','{"dateFrom":"2026-02-30","dateTo":"2026-03-01"}','{"dateFrom":"2026-11-05","dateTo":"2026-11-01"}'])assert.deepEqual(readReportPeriod(now,{getItem:()=>raw}),{dateFrom:'2026-11-03',dateTo:'2026-11-03'});
 assert.deepEqual(readReportPeriod(now,{getItem:()=>{throw Error('storage disabled');}}),{dateFrom:'2026-11-03',dateTo:'2026-11-03'});
});
