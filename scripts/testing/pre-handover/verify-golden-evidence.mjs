// Recheck captured real outputs independently; property ordering is immaterial.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {output,save} from './context.mjs';
const evidence=JSON.parse(await readFile(path.join(output,'golden-day.json'),'utf8'));
assert.equal(evidence.completed,true);assert.equal(evidence.steps.length,31);
const checks=evidence.checks.map(c=>({...c,passed:isDeepStrictEqual(c.expected,c.actual)}));
for(const [name,expected,actual]of [['customer A debt',1500,evidence.final.customerA.total_in_minor_units],['customer B debt',3000,evidence.final.customerB.total_in_minor_units],['supplier pending value',10000,Number(evidence.final.pending.pendingValueInMinorUnitsExact)]])checks.push({name,expected,actual,passed:expected===actual});
const report={capturedRun:evidence.startedAt,originalComparatorIssue:'JSON property order only;preserved original evidence unchanged',checks,ok:checks.every(c=>c.passed)};
await save('golden-day-independent-verification',report);console.log(JSON.stringify(report));assert.equal(report.ok,true);
