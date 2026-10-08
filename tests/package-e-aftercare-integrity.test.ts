import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {aftercareIntegrityWarning,AFTERCARE_INTEGRITY_KEY} from '../src/utils/aftercareIntegrity';
import type {MonitoringDashboard} from '../src/types/monitoring';

const now=Date.parse('2026-10-08T12:00:00Z');
const dashboard=(status='healthy',age=0,issues=0):MonitoringDashboard=>({
  overallStatus:'healthy',counts:{healthy:1,warning:0,critical:0,unknown:0},
  lastScanAt:new Date(now-age).toISOString(),scanErrorCode:null,
  checks:[{key:AFTERCARE_INTEGRITY_KEY,category:'accounting',source:'database',
    status:status as 'healthy',severity:'critical',issueCount:issues,summary:'test',details:{},
    checkedAt:new Date(now-age).toISOString(),changedAt:new Date(now-age).toISOString()}],
});
test('fresh exact healthy check alone removes the integrity warning',()=>{
  assert.equal(aftercareIntegrityWarning(dashboard(),now),null);
  assert.equal(aftercareIntegrityWarning(dashboard('healthy',86400000),now),null);
  for(const value of [null,{...dashboard(),checks:[]},dashboard('critical'),dashboard('unknown'),
    dashboard('healthy',86400001),dashboard('healthy',-1),dashboard('healthy',0,1),
    {...dashboard(),scanErrorCode:'P0001'}]) {
    if(value) assert.ok(aftercareIntegrityWarning(value,now));else assert.ok(aftercareIntegrityWarning(null,now));
  }
});
test('invalid timestamp fails closed, including dashboard lookup failure',()=>{
  const value=dashboard();value.checks[0].checkedAt='not-a-date';
  assert.ok(aftercareIntegrityWarning(value,now));
  assert.ok(aftercareIntegrityWarning(null,now));
  assert.ok(aftercareIntegrityWarning({} as MonitoringDashboard,now));
  assert.ok(aftercareIntegrityWarning({...dashboard(),checks:[null]} as unknown as MonitoringDashboard,now));
});
test('134 preserves writers/ACL and uses strict independent seven-day validators/alert pipeline',()=>{
  const sql=readFileSync('supabase/migrations/134_package_e_read_performance.sql','utf8');
  assert.match(sql,/settled_at>=p_observed_at-INTERVAL '7 days'/u);
  assert.match(sql,/issued_at>=p_observed_at-INTERVAL '7 days'/u);
  for(const name of ['phase42_assert_operational_return_evidence_internal','phase43_assert_operational_replacement_evidence_internal'])
    assert.ok(sql.includes(`public.${name}(v_operation.operation_id,true)`));
  assert.match(sql,/v_total_integrity := v_total_integrity \+ v_evidence_issues/u);
  assert.match(sql,/'business-integrity:system','business_integrity_warning'/u);
  assert.match(sql,/'critical' END,'critical',v_evidence_issues/u);
  assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.(?:settle_|phase42_assert|phase43_assert)|\bGRANT\b|\bREVOKE\b/u);
  const proof=readFileSync('scripts/testing/package-e-report-parity.mjs','utf8');
  assert.match(proof,/old_result::text IS DISTINCT FROM c.new_result::text/u);
  assert.match(proof,/excludedTimeFields','\[\]'::jsonb/u);
});
