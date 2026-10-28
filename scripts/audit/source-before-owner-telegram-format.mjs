// Only exact approved display changes are unwound for historical evidence.
import {sourceBeforeBulkProductImages,restoreBulkImageSourceHashes} from './source-before-bulk-product-images.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const telegramFormatPins=JSON.parse(readFileSync(new URL('./owner-telegram-format-source-pins.json',import.meta.url),'utf8')).entries;
const hash=s=>createHash('sha256').update(s).digest('hex');
export function sourceBeforeOwnerTelegramFormat(file,text){
 if(text===null)return null;const restored=sourceBeforeBulkProductImages(file,text);if(restored===null)return null;const source=restored.replaceAll('\r\n','\n'),pin=telegramFormatPins[file];if(!pin)return source;
 if(hash(source)===pin.after){if(pin.added)return null;assert.equal(hash(pin.beforeText),pin.before,'TELEGRAM_FORMAT_INVERSE_CORRUPT');return pin.beforeText;}
 // Unrecognized App bytes stay intact so every existing entire-file historical
 // guard rejects them with its original error;never erase an unknown mutation.
 if(file==='src/App.tsx'||file.startsWith('tests/')||file.startsWith('scripts/operations/')||file==='scripts/testing/run-handover214-gates.mjs'||hash(source)===pin.before)return source;
 assert.fail('HANDOVER214_UNREVIEWED_SOURCE:TELEGRAM_FORMAT:'+file);
}
export function restoreOwnerTelegramFormatSourceHashes(sources){return restoreBulkImageSourceHashes(sources).flatMap(s=>{
 const pin=telegramFormatPins[s.file];if(!pin||s.sha256!==pin.after)return [s];
 const current=readFileSync(new URL('../../'+s.file,import.meta.url),'utf8').replaceAll('\r\n','\n');
 assert.equal(hash(current),pin.after,'TELEGRAM_FORMAT_CURRENT_SOURCE_CHANGED');
 const before=sourceBeforeOwnerTelegramFormat(s.file,current);return before===null?[]:[{...s,sha256:hash(before)}];
});}
