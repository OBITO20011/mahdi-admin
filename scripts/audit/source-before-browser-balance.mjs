import {beforeRetentionDocs} from './source-before-retention-docs.mjs';
// Exact, test-only historical view. Current discovery, SDK and CI execution
// always use the unprojected ten-shard sources and all original test identities.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const browserBalancePins=JSON.parse(readFileSync(new URL('./browser-balance-source-pins.json',import.meta.url),'utf8'));
const hash=text=>createHash('sha256').update(text).digest('hex');
export function sourceBeforeBrowserBalance(file,text){
 if(text===null)return null;
 text=beforeRetentionDocs(file,text);
 const raw=text.replaceAll('\r\n','\n'),pin=browserBalancePins.entries[file];
 if(!pin||hash(raw)!==pin.after)return raw;
 assert.equal(hash(pin.beforeText),pin.before,'BROWSER_BALANCE_INVERSE_CORRUPT:'+file);
 return pin.beforeText;
}
