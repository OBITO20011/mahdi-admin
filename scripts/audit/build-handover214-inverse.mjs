// Mechanical test evidence only; never executes old application/SQL source.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const baseline = '2c2dcacaa45b20ee83da6e67fddbac3ca749d808';
const lf = text => text.replaceAll('\r\n', '\n');
const hash = text => createHash('sha256').update(text).digest('hex');
const known = new Set();
for (const name of readdirSync(import.meta.dirname).filter(f => f.endsWith('-hunks.json') || ['handover213-inverse.json', 'owner-acl212-inverse.json'].includes(f)))
  for (const file of Object.keys(JSON.parse(readFileSync(new URL('./' + name, import.meta.url), 'utf8')).entries)) known.add(file);
const changed = execFileSync('git', ['diff', '--name-only', baseline], {encoding: 'utf8'}).trim().split('\n');
const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {encoding: 'utf8'}).trim().split('\n');
const entries = {};
for (const file of [...new Set([...changed, ...added])].sort().filter(file => file && (known.has(file) || /^(?:src\/|customer-web\/src\/|supabase\/)/.test(file)))) {
  const current = lf(readFileSync(file, 'utf8'));
  let beforeText = '', isAdded = false;
  try {beforeText = lf(execFileSync('git', ['show', baseline + ':' + file], {encoding: 'utf8', maxBuffer: 16 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe']}));}
  catch {isAdded = true;}
  entries[file] = {before: hash(beforeText), after: hash(current), beforeText, ...(isAdded ? {added: true} : {})};
}
writeFileSync(new URL('./handover214-inverse.json', import.meta.url), JSON.stringify({baseline, entries}, null, 2) + '\n');
console.log(JSON.stringify({pinned: Object.keys(entries).length}));
