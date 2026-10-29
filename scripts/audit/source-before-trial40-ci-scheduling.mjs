// Only exact approved CI bytes can restore the earlier integration proof.
import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';
import{sourceBeforeAftercare215}from'./source-before-aftercare215.mjs';
export const trial40CiPins=JSON.parse(readFileSync(new URL('./trial40-ci-scheduling-source-pins.json',import.meta.url),'utf8')).entries;
const hash=t=>createHash('sha256').update(t).digest('hex');
export function sourceBeforeTrial40Ci(file,text){const source=sourceBeforeAftercare215(file,text),pin=trial40CiPins[file];if(source===null||!pin||!pin.approvedAfter.includes(hash(source)))return source;assert.equal(hash(pin.beforeText),pin.before,'TRIAL40_CI_INVERSE_CORRUPT:'+file);return pin.beforeText;}
