import {classifyCutoverCommand} from './cutover-command-contract.mjs';

export const cutover225CommandDocuments=Object.freeze([
 'GO_LIVE_CUTOVER_AR','UPGRADE222_AR','UPGRADE223_AR','UPGRADE224_AR',
 'UPGRADE225_AR','D1_REFERENCE_KIT225_AR','RESET225_OWNER_AR','ON225_OPENING_WORKBOOK_AR',
]);

export function classifyCutover225Command(command){
 const hold=/^node scripts\/operations\/frankfurt-owner-cutover-hold225\.mjs --hold-(upgrade|reset)(?:\s|$)/u.exec(command);
 if(hold)return {kind:'offline',script:'scripts/operations/frankfurt-owner-cutover-hold225.mjs',mode:'--plan',phase:'--hold-'+hold[1]};
 if(/^node scripts\/operations\/frankfurt-owner-upgrade225\.mjs(?:\s|$)/u.test(command))
  return {kind:'offline',script:'scripts/operations/frankfurt-owner-upgrade225.mjs',mode:'--dry-run'};
 if(/^node scripts\/operations\/frankfurt-owner-reset225\.mjs(?:\s|$)/u.test(command))
  return {kind:'offline',script:'scripts/operations/frankfurt-owner-reset225.mjs',mode:'--plan'};
 if(/^scripts\/operations\/d1-reference225-(?:kit|install)\.ps1(?:\s|$)/u.test(command))
  return {kind:'no-offline-mode',reason:'D1 requires exact main, GitHub CI and owner approval before install.'};
 if(/^node --import tsx scripts\/operations\/on-opening225\/cli\.ts --mode (?:convert|stock)(?:\s|$)/u.test(command))
  return {kind:'offline-converter',reason:'Uses local inputs; real XLSX CLI behavior is exercised by on-opening225-converter.test.ts.'};
 if(/^node scripts\/operations\/two-stage225-cli\.mjs --mode (?:alert-query|query|verify)(?:\s|$)/u.test(command))
  return {kind:'offline-converter',reason:'Local approved backup baseline, SELECT generation and hash comparison only; no database connection.'};
 if(/^powershell\.exe -NoProfile -File scripts\/operations\/two-stage225-backup\.ps1(?:\s|$)/u.test(command))
  return {kind:'no-offline-mode',reason:'Local encrypted archive preparation requires the owner local DPAPI configuration; no database or hosted connection. The core is tested with local archive fixtures and the real isolated rehearsal.'};
 if(/^node scripts\/operations\/build-acl-reference224\.mjs --output(?:\s|$)/u.test(command))
  return {kind:'offline-reference-build',reason:'Builds the historical reference in isolated local Docker; entrypoint is read-only toward projects.'};
 return classifyCutoverCommand(command);
}
