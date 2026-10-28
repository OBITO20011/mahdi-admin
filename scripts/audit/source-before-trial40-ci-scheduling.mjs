// Only exact approved CI bytes can restore the earlier integration proof.
import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';
export const trial40CiPins=JSON.parse(readFileSync(new URL('./trial40-ci-scheduling-source-pins.json',import.meta.url),'utf8')).entries;
const hash=t=>createHash('sha256').update(t).digest('hex');
export function sourceBeforeTrial40Ci(file,text){const source=text.replaceAll('\r\n','\n'),pin=trial40CiPins[file];if(!pin||!pin.approvedAfter.includes(hash(source)))return source;assert.equal(hash(pin.beforeText),pin.before,'TRIAL40_CI_INVERSE_CORRUPT:'+file);return pin.beforeText;}
