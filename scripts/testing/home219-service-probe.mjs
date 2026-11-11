import assert from 'node:assert/strict';

// Only this test diagnostic may install the explicitly quarantined prototype
// into its OWN fresh audit container. Owner upgrade/reset databases stay219.
export function home219ServiceProbeArgs(args){
 assert.ok(Array.isArray(args)&&(!args.length||args.length===1&&args[0]==='--sales-only-phase2'),'HOME219_DIAGNOSTIC_OPTION_REQUIRED');
 return ['scripts/audit/run-service-access-diagnostic.mjs','--migration-ceiling','219',
  ...(args.length?['--quarantined-prototype','sales-only-phase2']:[])];
}
