import {readFile,writeFile,mkdir,copyFile,rename,unlink,open,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {sha256,requireD1,repositoryState,externalPath,ordinaryPath} from './d1-reference220-state.mjs';
import {verifyD1Ci} from './d1-reference-ci.mjs';
const exec=promisify(execFile),name='local-reference-through220-ready.json';
const policyFile=new URL('./d1-known-owner-files.json',import.meta.url);
const files=['scripts/operations/frankfurt-owner-reset220.mjs','scripts/operations/trial-reset220-core.mjs','scripts/operations/reset220-foundation.mjs','scripts/operations/reset220-pg-cron-guard.mjs','scripts/operations/frankfurt-owner-build.mjs','docs/operations/TABLE_ACCESS_AFTER_220.json','scripts/operations/reset220-write-guard.mjs','scripts/operations/reset220-session.mjs','scripts/operations/reset220-private-state.mjs','scripts/operations/sales-only220-catalog.mjs','docs/design/sales-only-phase3/catalog220-pins.json'];
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const exists=async file=>{try{await access(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
export async function d1Readiness(root,file){const module=await import(pathToFileURL(path.join(root,'scripts/operations/frankfurt-reference220.mjs')).href);return module.readReady220Reference(root,file);}
export async function d1SourceHashes(root){
 const protectedPins=await json(path.join(root,'scripts/testing/rehearsal220-owner-source-pins.json'));
 const hashes={};for(const file of [...new Set([...files,...protectedPins.files.map(p=>p[0])])].sort())hashes[file]=sha256(await readFile(path.join(root,file)));
 return hashes;
}
async function defaultBuild(root,target,folder){
 let result;try{result=await exec(process.execPath,[path.join(root,'scripts/operations/build-acl-reference220.mjs'),'--output',target],{cwd:root,windowsHide:true,maxBuffer:16*1024**2});}catch{throw new Error('D1_REFERENCE_BUILD_FAILED');}
 let report;try{report=JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));}catch{throw new Error('D1_BUILD_REPORT_INVALID');}
 requireD1(report.ok===true&&report.repositoryStayedFrozen===true,'D1_REFERENCE_BUILD_FAILED');
 await externalPath(root,report.output);const diff=await json(path.join(report.output,'fresh-incremental-differences.json'));
 requireD1(Array.isArray(diff)&&diff.length===0,'D1_CATALOG_DIFFERENCE');
 await copyFile(path.join(report.output,'fresh-incremental-differences.json'),path.join(folder,'fresh-incremental-differences.json'),constants.COPYFILE_EXCL);
 await writeFile(path.join(folder,'build-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});return report;
}
const defaultDeps={state:repositoryState,ci:verifyD1Ci,ready:d1Readiness,hashes:d1SourceHashes,build:defaultBuild};
export async function prepareD1({root,outputRoot=path.join(homedir(),'NawasrahFrankfurt','D1-candidates'),testCandidateOnly=false},dependencies={}){
 const d={...defaultDeps,...dependencies},known=await json(policyFile),state=await d.state(root,known);root=state.root;
 const ci=await d.ci(root,state.head),before=await d.hashes(root);
 const outside=await externalPath(root,outputRoot,{missing:true});requireD1(!outside.split(path.sep).some(p=>p.toLowerCase()==='nawasrah-fra-001-138'),'D1_OWNER_WORKDIR_REFUSED');
 await mkdir(outside,{recursive:true});await externalPath(root,outside);
 const folder=path.join(outside,'D1-'+new Date().toISOString().replaceAll(/[:.]/gu,'-')+'-'+randomUUID().slice(0,8));await mkdir(folder);
 const candidate=path.join(folder,name);let stage='build';
 try{
  const build=await d.build(root,candidate,folder);requireD1(build.ok===true&&build.repositoryStayedFrozen===true,'D1_REFERENCE_BUILD_FAILED');
  const differences=await json(path.join(folder,'fresh-incremental-differences.json'));requireD1(Array.isArray(differences)&&differences.length===0,'D1_CATALOG_DIFFERENCE');
  stage='readiness';const ref=await d.ready(root,candidate);requireD1(ref.migrationCeiling===220&&ref.manifest.length===181&&ref.functions===678&&ref.realtimePublication.tables.length===13&&ref.freshIncrementalDifferenceCount===0,'D1_REFERENCE_NOT_READY');
  requireD1(JSON.stringify(before)===JSON.stringify(await d.hashes(root)),'D1_SOURCE_CHANGED');requireD1(JSON.stringify(state)===JSON.stringify(await d.state(root,known)),'D1_SOURCE_CHANGED');
  await d.ci(root,state.head); // Remote main/CI may have changed during the local build.
  const source={mainSha:state.head,hashes:before,dependencyHashesSha256:sha256(JSON.stringify(before))};
  const report={format:1,ok:true,status:'CANDIDATE_AWAITING_OWNER_APPROVAL',testCandidateOnly,createdAt:new Date().toISOString(),root,folder,candidate,candidateSha256:sha256(await readFile(candidate)),source,ci,localOnly:true,hostedAccess:false,currentReferenceTouched:false,installed:false,migrations:181,functions:678,realtime:13,accessQueries:ref.readiness.queries,freshIncrementalDifferences:0,ownerSignature:null};
  await writeFile(path.join(folder,'approval.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  const line=file=>'`'+before[file]+'`';
  await writeFile(path.join(folder,'اعتماد-مرجع-D1.md'),[
   '# اعتماد مرجع RESET220 — D−1',
   testCandidateOnly?'**مرشح اختبار محلي فقط؛ ليس اعتماداً ليوم التشغيل ولا إذناً بالتثبيت.**':'**مرشح ينتظر اعتماد المالك؛ لم يُثبّت ولم يُلمس المرجع الحالي.**',
   '- رأس main: `'+state.head+'`؛CI كامل أخضر مطابق،والأسرار والنسخ ناجحة.',
   '- المرشح: `'+candidate+'`',
   '- SHA-256 المرشح: `'+report.candidateSha256+'`',
   '- دليل الوصول TABLE_ACCESS_AFTER_220.json: '+line(files[5]),
   '- RESET220: '+line(files[0]),
   '- النواة trial-reset214-core: '+line(files[1]),
   '- النواة trial-reset-core: '+line(files[2]),
   '- حارس pg_cron: '+line(files[3]),
   '- بصمة مجموعة تبعيات الأداة: `'+source.dependencyHashesSha256+'`؛التفاصيل فيapproval.json.',
   '- الجاهزية:220/181 ملفاً/678 دالة/13Realtime/'+report.accessQueries+'فحص وصول؛fresh-incremental-differences.json=[]؛مصادر المستودع ثابتة.',
   '- CI: '+Object.values(ci.runs).map(r=>r.url).join(' · '),
   '',
   '**ما يعتمده المالك:** هذا الملف بعينه وبصمته الكاملة على رأس main والبصمات أعلاه،للاستعمال مع RESET220 فقط بعد بروفة النسخة الفاصلة. لا يشمل توقيعه تنفيذ RESET أو النشر. لا تُقبل البصمة التاريخية A915…؛لا تركيب أثناء محاولة قائمة أوresume. أي تغيير في الرأس أو المصادر يستلزم مرشحاً ومراجعة جديدين.',
   'التوقيع: ____________________  التاريخ: ____________  القرار: قبول / رفض',
  ].join('\n')+'\n',{flag:'wx'});return report;
 }catch(error){await writeFile(path.join(folder,'failure.json'),JSON.stringify({ok:false,stage,code:d1ErrorCode(error),currentReferenceTouched:false,installed:false},null,2));throw error;}
}
async function noAttempt(workdir){for(const version of [214,215,216,217,219,220])requireD1(!await exists(path.join(workdir,'RESET'+version+'_IN_PROGRESS.json')),'D1_RESET_IN_PROGRESS');}
export async function installD1({root,candidate,approvedSha256,workdir=path.join(homedir(),'NawasrahFrankfurt','nawasrah-fra-001-138')},dependencies={}){
 const d={...defaultDeps,...dependencies};requireD1(typeof approvedSha256==='string'&&/^[a-fA-F0-9]{64}$/u.test(approvedSha256),'D1_FULL_APPROVED_HASH_REQUIRED');approvedSha256=approvedSha256.toLowerCase();
 const state=await d.state(root,await json(policyFile));root=state.root;candidate=await externalPath(root,candidate);requireD1(path.basename(candidate)===name,'D1_CANDIDATE_NAME_REQUIRED');
 const proof=await json(path.join(path.dirname(candidate),'approval.json'));requireD1(proof.ok===true&&!proof.testCandidateOnly&&proof.status==='CANDIDATE_AWAITING_OWNER_APPROVAL','D1_CANDIDATE_NOT_APPROVABLE');
 requireD1(proof.source.mainSha===state.head,'D1_APPROVED_HEAD_CHANGED');requireD1(proof.candidateSha256===approvedSha256&&sha256(await readFile(candidate))===approvedSha256,'D1_APPROVED_HASH_MISMATCH');
 requireD1(JSON.stringify(proof.source.hashes)===JSON.stringify(await d.hashes(root)),'D1_SOURCE_CHANGED');await d.ready(root,candidate);
 workdir=await externalPath(root,workdir);await noAttempt(workdir);const target=path.join(workdir,name),suffix=randomUUID(),incoming=target+'.incoming-'+suffix,backup=target+'.before-D1-'+suffix;
 await ordinaryPath(target,{missing:true});requireD1(path.resolve(candidate)!==target,'D1_CANDIDATE_IS_TARGET');
 let lock;try{lock=await open(path.join(workdir,'.D1_REFERENCE_INSTALL.lock'),'wx');}catch{throw new Error('D1_INSTALL_BUSY');}
 let before=null,replaced=false,backedUp=false;
 try{
  await noAttempt(workdir);if(await exists(target)){before=sha256(await readFile(target));await copyFile(target,backup,constants.COPYFILE_EXCL);requireD1(sha256(await readFile(backup))===before,'D1_PREVIOUS_BACKUP_HASH_MISMATCH');backedUp=true;}
  await copyFile(candidate,incoming,constants.COPYFILE_EXCL);requireD1(sha256(await readFile(incoming))===approvedSha256,'D1_INCOMING_HASH_MISMATCH');await d.ready(root,incoming);
  await noAttempt(workdir);requireD1(before===null?!await exists(target):sha256(await readFile(target))===before,'D1_TARGET_CHANGED');
  requireD1(JSON.stringify(state)===JSON.stringify(await d.state(root,await json(policyFile))),'D1_SOURCE_CHANGED');
  requireD1(JSON.stringify(proof.source.hashes)===JSON.stringify(await d.hashes(root)),'D1_SOURCE_CHANGED');
  requireD1(sha256(await readFile(candidate))===approvedSha256,'D1_APPROVED_HASH_MISMATCH');
  requireD1(sha256(await readFile(incoming))===approvedSha256,'D1_INCOMING_HASH_MISMATCH');
  await rename(incoming,target);replaced=true;requireD1(sha256(await readFile(target))===approvedSha256,'D1_TARGET_HASH_MISMATCH');await d.ready(root,target);await noAttempt(workdir);
  requireD1(sha256(await readFile(target))===approvedSha256,'D1_TARGET_HASH_MISMATCH');
  const report={ok:true,mainSha:state.head,candidate,target,beforeSha256:before,afterSha256:approvedSha256,previousCopy:backedUp?backup:null,readiness:true,installedAt:new Date().toISOString()};
  await writeFile(target+'.installation-'+suffix+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});return report;
 }catch(error){
  if(replaced){requireD1(sha256(await readFile(target))===approvedSha256,'D1_ROLLBACK_TARGET_CHANGED_STOP');if(backedUp){const rollback=target+'.incoming-rollback-'+suffix;await copyFile(backup,rollback,constants.COPYFILE_EXCL);requireD1(sha256(await readFile(rollback))===before,'D1_ROLLBACK_HASH_MISMATCH');await rename(rollback,target);}else await unlink(target);}
  throw error;
 }finally{if(await exists(incoming))await unlink(incoming);await lock.close();await unlink(path.join(workdir,'.D1_REFERENCE_INSTALL.lock'));}
}
const messages={D1_MAIN_REQUIRED:'شغّل التجهيز من فرع main المعتمد.',D1_ORIGIN_MAIN_MISMATCH:'الرأس يختلف عن origin/main؛ حدّثه بأمان ثم أعد التجهيز.',D1_REMOTE_MAIN_MISMATCH:'main على GitHub تغيّر؛ توقف وثبّت الرأس وCI من جديد.',D1_DIRTY_TREE_REFUSED:'توجد تعديلات غير معروفة؛ احفظها واطلب مراجعتها.',D1_OWNER_FILE_CHANGED:'تغيّرت ملفات المالك عن البصمات المعروفة؛ توقف للمراجعة.',D1_CI_UNVERIFIED_MANUAL_REVIEW_REQUIRED:'تعذّر التحقق من GitHub. توقف: افتح تشغيلات الرأس نفسه واطلب تأكيد المالك يدوياً؛ لا تتجاوز هذه البوابة.',D1_CI_NOT_FULL_GREEN:'CI الكامل أو الأسرار أو النسخ غير أخضر على الرأس نفسه؛ توقف.',D1_REFERENCE_BUILD_FAILED:'فشل بناء المرجع المحلي؛ راجع سجل البناء المعزول.',D1_CATALOG_DIFFERENCE:'ظهر فرق كتالوج بين البناءين؛ لا يُعتمد المرشح.',D1_RESET_IN_PROGRESS:'توجد محاولة RESET220 قائمة؛ احتفظ بمرجعها ولقطتها ولا تثبّت.',D1_FULL_APPROVED_HASH_REQUIRED:'مرّر بصمة SHA-256 الكاملة التي اعتمدها المالك صراحةً.',D1_APPROVED_HASH_MISMATCH:'بصمة المرشح تختلف عن المعتمدة؛ لم يُثبّت.',D1_CANDIDATE_NOT_APPROVABLE:'هذا مرشح اختبار أو تقرير غير صالح للاعتماد؛ لا يُثبّت.',D1_SOURCE_CHANGED:'تغيّرت مصادر الوصول أو تبعيات الأداة؛ جهّز مرشحاً جديداً.',D1_APPROVED_HEAD_CHANGED:'تغيّر main بعد التقرير؛ يلزم تجهيز واعتماد جديدان.'};
export function d1ErrorCode(error){const first=String(error?.message??'').split('\n')[0];return /^D1_[A-Z0-9_]+$/u.test(first)?first:'D1_LOCAL_VALIDATION_FAILED';}
export async function d1Main(args){
 const mode=args.shift();requireD1(['prepare','install'].includes(mode),'D1_MODE_REQUIRED');const options={root:path.resolve(import.meta.dirname,'../..')},seen=new Set(),allowed=mode==='prepare'?['--root','--output-root']:['--root','--candidate','--approved-sha256','--workdir'];
 for(let i=0;i<args.length;i++){const key=args[i];requireD1(!seen.has(key),'D1_DUPLICATE_ARGUMENT');seen.add(key);if(key==='--test-candidate-only'&&mode==='prepare'){options.testCandidateOnly=true;continue;}requireD1(allowed.includes(key)&&args[i+1]&&!args[i+1].startsWith('--'),'D1_ARGUMENTS_INVALID');const field={'--root':'root','--output-root':'outputRoot','--candidate':'candidate','--approved-sha256':'approvedSha256','--workdir':'workdir'}[key];options[field]=args[++i];}
 if(mode==='install')requireD1(options.candidate&&options.approvedSha256,'D1_FULL_APPROVED_HASH_REQUIRED');
 return mode==='prepare'?prepareD1(options):installD1(options);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const r=await d1Main(process.argv.slice(2));console.log(JSON.stringify({ok:r.ok,folder:r.folder,candidate:r.candidate,candidateSha256:r.candidateSha256,mainSha:r.source?.mainSha??r.mainSha,installed:r.installed??r.readiness,testCandidateOnly:r.testCandidateOnly}));}catch(error){const code=d1ErrorCode(error);console.error((messages[code]??'توقف: فشل فحص محلي محروس؛ راجع الرمز قبل المتابعة.')+' ['+code+']');process.exitCode=1;}}
