// Inventory actual documented commands; unknown tools fail closed.
import assert from 'node:assert/strict';
export const cutoverCommandDocuments=Object.freeze(['GO_LIVE_CUTOVER_AR','UPGRADE222_AR','UPGRADE223_AR','UPGRADE224_AR','D1_REFERENCE_KIT224_AR','RESET224_OWNER_AR']);
export function documentedCutoverCommands(documents){
 const result=[];
 for(const[document,text]of Object.entries(documents))for(const match of text.matchAll(/`([^`\n]+)`/gu)){
  const command=match[1].trim();
  if(/^(?:node |npm(?:\.cmd)? |powershell(?:\.exe)? |(?:scripts\/operations\/)?d1-reference\d+-(?:kit|install)\.ps1(?:\s|$))/u.test(command))result.push({document,command});
 }
 assert.ok(result.length>0,'CUTOVER_COMMANDS_MISSING');
 return result;
}
export function classifyCutoverCommand(command){
 const upgrade=/^node scripts\/operations\/frankfurt-owner-upgrade(222|223|224)\.mjs(?:\s|$)/u.exec(command);
 if(upgrade)return{kind:'offline',script:`scripts/operations/frankfurt-owner-upgrade${upgrade[1]}.mjs`,mode:'--dry-run',
  limitation:'apply/verify-only/preflight-registration/resume-registration require a connected database;only their actual offline adapter is executed here'};
 if(/^node scripts\/operations\/frankfurt-owner-reset224\.mjs(?:\s|$)/u.test(command))return{kind:'offline',script:'scripts/operations/frankfurt-owner-reset224.mjs',mode:'--plan',
  limitation:'RESET dry-run is connected read-only;apply/resume are never executed by this offline command check'};
 if(/^(?:scripts\/operations\/)?d1-reference(?:223|224)-(?:kit|install)\.ps1(?:\s|$)/u.test(command))return{kind:'no-offline-mode',reason:'D1 prepare/install have no offline mode:exact-main GitHub CI and owner approval are required;historical223 kit is not the current cutover kit'};
 if(/^powershell\.exe .*scripts\/operations\/frankfurt-backup-owner\.ps1 -Mode Status$/u.test(command))return{kind:'no-offline-mode',reason:'Status reads owner-local scheduled-task/configuration state and has no isolated offline mode'};
 if(/^npm\.cmd run deploy:admin -- --check$/u.test(command))return{kind:'no-offline-mode',reason:'Existing --check reads origin/main via git ls-remote;it is not network-offline'};
 if(/^npm\.cmd run backup:run$/u.test(command))return{kind:'no-offline-mode',reason:'Backup run reads its configured owner source and has no offline mode;never executed by this contract'};
 if(/^npm\.cmd run frankfurt-owner-upgrade214 -- --verify-only$/u.test(command))return{kind:'no-offline-mode',reason:'Historical214 verify-only is connected read-only;not the current220-to224 cutover command'};
 if(/^node scripts\/deployment\/check-customer\.mjs --check$/u.test(command))return{kind:'no-offline-mode',reason:'Existing --check builds SEO from its selected source;isolated SEO fixtures are deliberately not production-deployable'};
 // Documentation may show the existing local build/verify commands with context.
 if(/^node (?:scripts\/environments\/verify-dist|customer-web\/scripts\/verify-seo-output|scripts\/environments\/prelaunch-trial-control|scripts\/operations\/build-cron-report)\.mjs(?:\s|$)/u.test(command))return{kind:'no-offline-mode',reason:'Requires its own explicit local output or environment context;not an upgrade/reference admission command'};
 assert.fail('CUTOVER_COMMAND_UNREVIEWED:'+command);
}
