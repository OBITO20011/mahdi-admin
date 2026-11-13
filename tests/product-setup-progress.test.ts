import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {productSetupProgress} from '../src/features/goLive/goLiveImport';

test('catalog definition includes the 344 flavors missed by batch history, using the existing DB count',()=>{
  assert.deepEqual(productSetupProgress({activeCount:1092,importedCount:748}),{value:1092,max:1092,label:'أصناف ونكهات نشطة معرّفة'});
  for(const importedCount of [0,748,1163,5000])assert.equal(productSetupProgress({activeCount:1092,importedCount}).value,1092);
  assert.deepEqual(productSetupProgress({activeCount:0,importedCount:748}),{value:0,max:0,label:'أصناف ونكهات نشطة معرّفة'});
  const sql=readFileSync('supabase/migrations/160_go_live_setup_foundation.sql','utf8');
  assert.match(sql,/'activeCount', \(SELECT COUNT\(\*\) FROM public.products WHERE is_active AND NOT is_flavor_master\)/u);
  const view=readFileSync('src/features/goLive/GoLiveSetupView.tsx','utf8');
  assert.match(view,/progress=\{productSetupProgress\(status.products\)\}/u);
  assert.match(view,/طابق الملف من معاينة الاستيراد قبل إنهاء البداية/u);
});
