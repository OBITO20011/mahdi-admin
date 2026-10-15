import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'../..');
const inline=v=>String(v??'—').replaceAll('|','\\|').replaceAll('\r','').replaceAll('\n',' ');
export function proposedAccess(source,evidence){
 const needed=new Map();
 const add=(table,role,operation,reason)=>{const key=[table,role,operation].join(':');if(!needed.has(key))needed.set(key,{table,role,operation,reasons:[]});needed.get(key).reasons.push(reason);};
 for(const e of source.entries){for(const op of e.operation==='upsert'?['insert','update']:[e.operation])add(e.table,e.role,op,e.id);
  if(e.operation!=='select'&&e.calls.some(c=>c.method==='select'))add(e.table,e.role,'select','returning '+e.id);
  for(const table of e.embeddedTables)add(table,e.role,'select','embedded in '+e.id);}
 for(const s of source.subscriptions)add(s.table,s.role,'select',`Realtime prerequisite ${s.file}:${s.line}`);
 return [...needed.values()].sort((a,b)=>[a.role,a.table,a.operation].join().localeCompare([b.role,b.table,b.operation].join(),'en')).map(n=>{
  const actual=evidence.access.find(a=>a.table===n.table&&a.role===n.role);assert.ok(actual,'MISSING_ACCESS_EVIDENCE:'+n.table);
  const ok=actual.privileges[n.operation.toUpperCase()];
  const directQueries=source.entries.filter(e=>e.table===n.table&&e.role===n.role&&e.operation==='select');
  const protectedColumnRead=!ok&&n.operation==='select'&&actual.selectableColumns.length>0&&directQueries.length>0&&directQueries.every(e=>{
   const results=evidence.results.filter(r=>r.id===e.id);return results.length>0&&results.every(r=>r.outcome==='success'||r.outcome==='zero_rows');});
  const command={select:'r',insert:'a',update:'w',delete:'d'}[n.operation];
  const applicable=actual.policies.filter(p=>(p.command==='*'||p.command===command)&&(p.roles.includes(n.role)||p.roles.includes('PUBLIC')));
  return {...n,rls:actual.rls,policies:actual.policies.map(p=>p.name),action:ok?'KEEP_EXISTING':protectedColumnRead?'KEEP_EXISTING_COLUMN_GRANTS':'PROPOSE_GRANT',
   policyCoverage:n.role==='service_role'?'BYPASSRLS':!actual.rls?'NO_RLS':!applicable.some(p=>p.permissive)?'NO_PERMISSIVE_POLICY':'PERMISSIVE_AND_APPLICABLE_RESTRICTIONS',applicablePolicies:applicable,
   redFlag:!actual.rls&&n.role!=='service_role',selectableColumns:actual.selectableColumns};
 });
}
export function renderReport(source,evidence){
 const proposal=proposedAccess(source,evidence),newGrants=proposal.filter(p=>p.action==='PROPOSE_GRANT'),
  denied=evidence.results.filter(r=>r.sqlstate==='42501'),other=evidence.results.filter(r=>r.outcome==='other_error'),
  blockedSites=new Set(denied.map(r=>r.id)),redFlags=proposal.filter(p=>p.redFlag),
  excess=evidence.access.filter(a=>a.role==='authenticated'||a.role==='anon').flatMap(a=>Object.entries(a.privileges)
   .filter(([p,yes])=>yes&&['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN','INSERT','UPDATE','DELETE'].includes(p))
   .map(([privilege])=>({table:a.table,role:a.role,privilege})));
 const rows=[
 '# دليل المرجع138 قبل المنح — تاريخي،2026-10-15',
 '', '**هذه نتائج138 السلبية،وليست حالة الشجرة بعد150. اعتُمدت150 لاحقاً؛راجع TABLE_ACCESS_AFTER_150.md للإثبات الحالي. لا تشغّل `frankfurt-align-acl.mjs --apply`؛لا اتصال بفرانكفورت/Production و140–149 محجوزة.**',
 '', '## النتيجة والنطاق', '',
 `- ${source.totals.queries} موضع استعلام: ${source.totals.authenticated} authenticated في الإدارة،${source.totals.service_role} service_role في send-order-push،${source.totals.anon} anon. المتجر لا يقرأ الجداول مباشرة؛RPC/Gateway خارج جرد الجداول.`,
 `- ${source.totals.tableNames.length} جدولاً مع الموارد المضمّنة؛${source.totals.subscriptions} اشتراك Realtime موثّق منفصلاً. Storage وArray.from مستبعدان بأسباب صريحة فيJSON.`,
 `- قاعدة جديدة001–138،138 سجلاً رسمياً. ${evidence.results.length} إعادة تشغيل فعلية لسلاسل SDK الأصلية عبر PostgREST16.1/PostgreSQL17.6: ${evidence.counts.success} نجاح،${denied.length} رفض42501 في${blockedSites.size} موضعاً،${evidence.counts.zero_rows} نتيجة صفرية،${other.length} أخطاء أخرى.`,
 `- جاهزية وصول التطبيق: **${evidence.applicationReady?'ناجح':'غير مقبول — المنح الحالية تعطل الوصول المباشر'}**. نجاح أداة التشخيص يعني جمع الأدلة فقط،لا قبول المنتج.`,
 `- زمن الفحص:${((Date.parse(evidence.endedAt)-Date.parse(evidence.startedAt))/1000).toFixed(3)}ث؛${evidence.startedAt} إلى${evidence.endedAt}.`,
 '', '## طريقة الإثبات وحدودها', '',
 'الجرد يستخدم TypeScript AST،لا grep وحده:كل from ذات جدول حرفي تتبعها سلسلة العمليات،والثوابت النصية للـselect،ومعدلات query اللاحقة،والـembeds. الاسم الديناميكي/عملية غير معروفة يفشلان الجرد بدلاً من إسقاطهما. JSON يحفظ source/الأعمدة/الفلاتر/الحمولات ومصدر الدور/المستدعين والأسطر وبصمات المصدر.',
 '', 'أُعيدت نفس طرق SDK والأعمدة والفلاتر والـsingle/maybeSingle والترتيب/الصفحات بمتغيرات fixture مصطنعة معلنة فيJSON،لا SELECT1 بديل. محوّل محلي يزيل mount /rest/v1 فقط مثل بوابة Supabase؛لا ردود وهمية. retries معطلة. JWT محلي للاختبار فقط فيRAM. كل قراءة إدارية أُجريت للمالك/admin/cashier؛هذا قياس وصول DB وليس ادعاء أن كل شاشة تسمح للأدوار الثلاثة. Edge بدورservice_role كما في createClient الفعلي؛لم تُشغّل Edge أو أي إرسال خارجي.',
 '', 'فحص RLS الإضافي نفّذ SET LOCAL ROLE وrequest.jwt.claims فعلياً داخل READ ONLY/ROLLBACK لكل جدول ولدورanon ومستخدم بلا دور ERP. لم تُضف أي منحة لتجاوز الرفض. عند42501 لا يمكن قياس إخفاء RLS؛نذكر الحجب لا نفترض صفراً. عند صفر مع عدم وجود صفوف fixture نذكر fixture_empty لا حجبRLS. سياسة موجودة في الكتالوج ليست إثباتاً بأنها تسمح لكل صف/فرع.',
 '', 'بيانات الفحص:مالك/admin/cashier ومستخدم بلا دور،أصناف/وحدات/فرع/مستودع/عملاء،استلامV2 مباشر،PO واستلام جزئي،بيعV2 بوحدة وطرد مشكّل بمكوّناته،اشتراك دفع وهمي بلا إرسال. إنشاء أدلة البيع/التكلفة عبرRPC الحالية؛لا نسخ بيانات حقيقية. عُطّل تريغر الإرسال وcron محلياً فقط قبل إدخال البيانات ثم حُذفت القاعدة. Realtime هنا جرد + شرط SELECT/RLS فقط،لا ادعاء اختبار قناة WebSocket من طرف لطرف.',
 '', '## كل موضع ومصيره الحقيقي', '',
 'الأثر التشغيلي الأوضح:fetchUserProfileAndRole يُرفض عندprofiles/user_roles،فيتعذر اعتماد ملف موظف صالح بعد تسجيل الدخول. قوائم الوحدات والمستودعات والأقسام والموردين وقراءاتالطلبات لا تعمل تحتالمرجع. createProductWithOpeningStockInSupabase ينفّذRPC ثم يقرأproducts للتحقق؛القراءةقد تفشل بعد نجاحالكتابة،فيعرضفشلاً كاذباً للمستخدم. لم نغيّر هذاالمسار. وفيEdge،كتاباتpush_dispatches/push_subscriptions مسموحة،لكنقراءةorders مرفوضة؛نجاحالكتابةوحده لايثبتنجاحالإشعار.',
 '',
 '| الجدول/العملية | الملف:السطر والدالة | الدور/المسار/المستدعون | النتيجة (كل الأدوار/المتغيرات) |',
 '|---|---|---|---|',
 ...source.entries.map(e=>{const results=evidence.results.filter(r=>r.id===e.id);return `| ${e.table} / ${e.operation}${e.embeddedTables.length?'؛ embeds:'+e.embeddedTables.join(','):''} | ${e.id} / ${e.function} | ${e.role}; ${inline(e.screenPaths.join(',')||e.screen)}; ${inline(e.callers.join(',')||e.reachability)} | ${inline(results.map(r=>r.appRole+':'+(r.sqlstate||r.outcome)+(r.variant==='with-query-extensions'?'/extended':'')).join('؛ '))} |`;}),
 '', 'عدم وجود مستدعي ثابت لا يعني حذف الدالة:الجرد يذكرها ولا يختلق شاشة. منحة مقترحة لدالة غير مستخدمة تحتاج مراجعة قبل اعتماد150. أسماء المسارات هنا مفاتيح شاشات الإدارة (?screen=...) ومستهلكو الوحدات فيsrc،لا تخمين لمسار HTTP مستقل.',
 '', '## فحص العلاقات المضمّنة في المرجع138', '',
 other.length?'PostgREST201 يسبق فحص بعض المنح. لا نحوله إلى42501 ولا نفترض أنGRANT يصلحه؛details/hint محفوظة فيJSON.':
  'بعد تصحيحFK المعتمد،لاPGRST201 فيمصدرالاستعلاماتالحالي حتىعلى138؛لكن42501 تبقىدون150. الإثباتالإيجابيبعد150 فيTABLE_ACCESS_AFTER_150.md. لمتتغيرحقول أوإجراءات المنتج،فقطخمسةhints لأربعسلاسل.',
 '', '| المصدر | الخطأ | العلاقات التي يعرضها PostgREST |', '|---|---|---|',
 ...[...new Set(other.map(r=>r.id))].map(id=>{const r=other.find(r=>r.id===id);return `| ${id} | ${inline(r.sqlstate+': '+r.message)} | ${inline(JSON.stringify(r.details))}; ${inline(r.hint)} |`;}),
 '', other.length?'العلاقة الملتبسة تحتاجFK صريحة لا تخميناً،ومنحSELECT وحدها لاتصلحها. فحصSQL الجدولي يثبت نقص المنح مستقلاً.':
  'اختبارAST المثبت يقارن ملفات الخدمات الثلاثة كاملةً بالأساس بعد إزالةأسماءFK المعتمدة فقط. رفض127سلسلةعلى138مقابلنجاح142على150 يحفظ الفحص السلبي ولايخفي نقصACL أوالتباس العلاقة.',
 '', '## RLS والمنح الدنيا المقترحة150 — للمراجعة فقط', '',
 `المقترح:${newGrants.length} منحة جدول/عملية/دور جديدة. ${redFlags.length} علامة حمراء:منحة يحتاجها التطبيق على جدول بلا RLS (service_role لديهBYPASSRLS بطبيعته،مذكور ولا يُفترض أنه يحميهRLS). لا منح anon مقترحة. لا INSERT/UPDATE/DELETE من المتصفح:تظل الكتابات عبرRPC. لا نوسّع منح الأعمدة الحالية فيbusiness_operations إلىSELECT كامل.`,
 '', '| الجدول | الدور/العملية | المطلوب | RLS | السياسات |', '|---|---|---|---|---|',
 ...proposal.map(p=>`| ${p.table} | ${p.role}/${p.operation.toUpperCase()} | ${p.action==='PROPOSE_GRANT'?`اقتراح GRANT ${p.operation.toUpperCase()} ON public.${p.table} TO ${p.role}`:p.action==='KEEP_EXISTING_COLUMN_GRANTS'?'إبقاء منح الأعمدة القائمة فقط':'إبقاء المنحة القائمة'} | ${p.rls?'مفعّل':'**غير مفعّل**'} | ${p.policyCoverage}; ${inline(p.applicablePolicies.map(p=>p.name+' ['+p.command+'/'+p.roles.join(',')+']').join('؛ '))} |`),
 '', 'السياسات التعبيرية كاملة (USING/WITH CHECK وpermissive/restrictive والأدوار)،وقيم الصلاحيات بما فيها الأعمدة ونتائج كل دور في TABLE_ACCESS_DIAGNOSTIC.json. سياسات الجداول القديمة تجمع سماح القراءة مع Require active ERP staff membership (032):جميع الموظفين الفعّالين المدرجين فيhelper،وليس المالك فقط؛المنحة إلىauthenticated تعتمد على ذلك. لا تعديل سياسات مقترح/منفّذ هنا.',
 '', 'المقترح أدنى عمليات على مستوى (جدول،عملية،دور)،لا منحALL ولا منحكتابةللمتصفح. منحSELECTعلىجدول ليستحارسأعمدة:مثلاًقارئتفاصيلالطلب يطلبcost_price_in_minor_units ضمنproducts بالفعل،وسياسةالموظفالنشط لا تميّز الكاشير عنالمالك. يجباعتمادهذاالمدىصراحةً مع150؛إذااقتُرح تقليصه لمنحأعمدة محددة يلزمفحصأعمدةالربط/الفلاتروRealtime أيضاً،ولا نغيّرحدودالتكلفةصمتاً هنا.',
 '', '### العلامات الحمراء', '',
 ...(redFlags.length?redFlags.map(p=>`- ${p.table}/${p.role}/${p.operation}:لاRLS؛يتطلب قراراً قبل أي منحة.`):['لا جدول عميل يحتاج منحة وRLS عليه مطفأ ضمن الجرد. هذا لا يثبت كفاية كل سياسة؛الحجب بسببACL يمنع تجربة الصفوف على تلك الجداول حتى تُعتمد منحة محددة.']),
 '', '### منح زائدة غير لازمة للوصول المباشر — اقتراح REVOKE فقط', '',
 `وجدنا${excess.length} زوج (جدول،دور،صلاحية) ضمن جداول الجرد لا يحتاجه أي وصول مباشر في الواجهتين. خصوصاً TRUNCATE لا تحميه سياسات الصفوف؛لا تعتبر Dxtm بديلاً آمناً عنCRUD. لم نُنفّذTRUNCATE أو REVOKE. هذه قائمة مقترحة محدودة بالجداول التي جرى فحصها،وليست إذناً بمسح جميعACL أوEXECUTE/sequences أوservice_role. تُراجع آثارRPC/التبعيات قبل150.`,
 '', '| الجدول | الدور | اقتراح سحب |', '|---|---|---|',
 ...[...new Set(excess.map(a=>a.table+':'+a.role))].sort().map(key=>{const [table,role]=key.split(':');return `| ${table} | ${role} | ${excess.filter(a=>a.table===table&&a.role===role).map(a=>a.privilege).join(', ')} |`;}),
 '', 'تُراجع كذلكdefault privileges لـpostgres فيpublic:سحبDxtm التلقائية للأدوارالعميلة عنداعتماد150 يمنع تكرارهاللجداولالجديدة. لا يُمنحSELECT افتراضياً لكل جدولجديد؛كلمنحةصريحةمعRLS واختبارها. service_role وEXECUTE وsequences خارجاقتراحالسحب الجدوليالحالي؛لا إعادةتطبيقخطة279REVOKE القديمة.',
 '', 'مصدر المقترح هو001–138 المحلية فقط. المنح الإضافية في فرانكفورت لم تُقرأ أو تُسحب؛خطة REVOKE للبعيد لا تصبح نهائية إلا بعد اعتماد150 ومرجعها الجديد،ومعاينة محلية للكتالوج المحفوظ/لقطة جديدة يلتقطها المالك. لا تأكيد أن فرنكفورت تتعطل الآن؛المثبت أن المواءمة للمرجع الحالي ستفقد وصولاً يحتاجه التطبيق.',
 '', '## الاشتراكات الحية (شروط قراءة،لا CRUD)', '', '| الجدول | المصدر | الحدث |', '|---|---|---|',
 ...source.subscriptions.map(s=>`| ${s.table} | ${s.file}:${s.line} | ${s.event} |`),
 '', '## اختبار الانحدار المقترح وخطة المواءمة الجديدة', '',
 '1. بعد موافقة150 فقط:يُوسّع حدبناءسكربتالتشخيص المعتمد حالياً138 إلى150. يبني CI قاعدة حقيقية001–150 (مع140–149 بعد دمج فرعها،لا placeholders)،ويزرع fixture عبر المسارات المعتمدة. يكتشف الجرد منالمصدر ويتطلب تغطية كل سلسلة وembed ودور. run-table-access-diagnostic.mjs --require-access يفشل عند42501 أو خطأ غير متوقع،لا mocks ولا retries. حالياًهذا الوضع يجب أن يفشل؛لا ندعي أنبوابة وصول التطبيق خضراء.',
 '2. اختباراتمنفصلة لسياسات الرفض:anon/مستخدم بلادور/موظفمتوقف لا يحصلونعلى صفوفغيرمصـرحبها؛واختبار منعكتابةالمتصفح المباشرة معنجاحRPC الصحيحة. أدوارممثلةحسبكلشاشة معprobe لأعمدةالربط والفلاتروكلصفحاتالاستعلام؛Realtime يحتاجاختبارقناةحقيقي لاحقاً وليسSELECTبديل.',
 '3. بعد اجتيازها،يُولّد local-reference جديد ببصمةسلسلةmigrations المعتمدة ونتيجةجرد/وصول. هدف frankfurt-acl-plan يصبحهذاالمرجع،لاlocal-reference138 الحالي. يرفضالمرجعالقديم أوتقريروصولغيرناجح/قديم قبلحسابREVOKE. service_role لايتغيربهذهالمواءمة،ولااستثناء لanon/authenticated/PUBLIC. إن احتاجEdge منحةناقصة فهيقرار150 صريح،لااستثناءعام.',
 '4. المالك وحده يطبّقmigrationالمعتمدة علىفرانكفورت لاحقاً ثميلتقطكتالوجاًجديداً،وتُعرضمعاينةالفرققبلأيتطبيق. --apply يبقىموقوفاًحتىقرارصريحجديد. لا تشغيلمحليبالصلاحياتالموسّعة لإخفاءالرفضالحالي.',
 '', '## إعادة الإنتاج', '', '```powershell',
 'node scripts/audit/table-access-inventory.mjs', 'node scripts/audit/run-table-access-diagnostic.mjs',
 'node scripts/audit/table-access-report.mjs <مسار-diagnostic.json-المطبوع>', '```',
 '', 'الأمرالثاني يشغّل قاعدةDocker محلية جديدة001–138 وخادمPostgREST على127.0.0.1:25421،ويغلقملكَه فيالنهاية. لايعرفعنوانفرانكفورت أوكلمةسرها،ولايفتحملفاتenv. تقريرJSON الخارجي يحفظكتالوجالفحص فقط؛نسخةالمستودع تحذفكتالوجالدوالغيرالمتعلق وتبقيأدلةالوصول. سكربتالجرد يولّدJSON وMarkdown؛سكربتالتقرير يضيفنتيجةالقياس الحقيقية بعدانتهائها.',
 '', '**سجل تاريخي:** هذه القائمة أساس اعتماد150 في OWNER_DECISIONS.md؛لا تستخدم مرجع138 لمواءمةACL الآن. إثبات ما بعد الإصلاح منفصل،وتطبيق فرانكفورت يبقى أمراً لاحقاً للمالك.',
 ];return rows.join('\n')+'\n';
}
export async function saveReport(source,evidence){
 const copy={...evidence,proposal:proposedAccess(source,evidence)};delete copy.catalog;
 await writeFile(path.join(root,'docs/operations/TABLE_ACCESS_DIAGNOSTIC.json'),JSON.stringify(copy,null,2)+'\n');
 await writeFile(path.join(root,'docs/operations/TABLE_ACCESS_INVENTORY.md'),await reportWithSupplement(source,evidence));
}
export async function reportWithSupplement(source,evidence){let extra='';
 try{extra=await readFile(path.join(root,'docs/operations/SERVICE_ACCESS_AUDIT.md'),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 let current='';try{
  const proof=JSON.parse(await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_150.json'),'utf8'));
  if(proof.applicationReady&&JSON.stringify(proof.sourceHashes)===JSON.stringify(source.sources))
   current='# جرد الوصول — الحالة بعد150\n\n**الوصول المباشر المحلي ناجح: '+proof.results.length+' سلسلةفعلية،صفر42501/PGRST2xx،والتغطيةكاملة.** [الدليل الإيجابي](TABLE_ACCESS_AFTER_150.md). --apply موقوف؛Auth/Storage/Realtime والإعداداتبواباتمنفصلة،لاادعاءقبولstaging. أدناهدليل138السلبي للمقارنة،لاهدفالمواءمة.\n\n---\n\n';
 }catch(error){if(error.code!=='ENOENT')throw error;}
 return current+renderReport(source,evidence)+(extra?'\n---\n\n'+extra.replace(/^# .*\n\n/u,''):'');}
export async function saveAfter150(source,evidence){
 assert.equal(evidence.migrationCeiling,150);assert.equal(evidence.infrastructureOk,true);
 assert.equal(evidence.applicationReady,true);assert.equal(evidence.coverage.complete,true);
 assert.deepEqual(evidence.sourceHashes,source.sources,'STALE_SOURCE_EVIDENCE');
 assert.ok(evidence.results.every(r=>r.sqlstate===null),'NO_QUERY_ERROR_ALLOWED');
 const copy={...evidence};delete copy.catalog;
 await writeFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_150.json'),JSON.stringify(copy,null,2)+'\n');
 const lines=['# الوصول المباشر بعد150 وتصحيحFK', '',
  '**PASS محلياً للوصول المباشر؛ليس إذناً بالمواءمة أو قبولstaging. لا اتصال مُدار.**', '',
  `قاعدة جديدة001–139+150،دون140–149. ${evidence.coverage.sourceSites} موضعاً،${evidence.results.length} سلسلةSDK فعلية: ${evidence.counts.success} نجاح،صفر42501 وصفرPGRST2xx وصفرأخطاءأخرى. تغطية كل الأدوار والمتغيرات كاملة بلا تكرار.`, '',
  `الوقت:${evidence.startedAt} إلى${evidence.endedAt}. أسماءmigrationsالمطبقة:${evidence.manifest.length} ملفاً،وأعلىرقم150. منح/RLS/أعمدة/صفوفكلدورفيJSON؛منحأعمدةbusiness_operations بقيتضيقة،وفحصcount(*)المرفوض لايُلغي نجاحقراءةالأعمدةالمسموحة الأصلية.`, '',
  '## الاستعلامات الأربعة', '', '| المصدر | النتائج الفعلية |', '|---|---|',
  ...['orders.service.ts:569','purchases.service.ts:381','purchases.service.ts:979','directReceiving.service.ts:209'].map(s=>{
   const rows=evidence.results.filter(r=>r.id.endsWith(s));assert.ok(rows.length>=3,'MISSING_FIXED_QUERY:'+s);
   return `| ${s} | ${rows.map(r=>r.appRole+'/'+r.variant+':'+r.outcome).join('؛ ')} |`;
  }), '',
  'اختير product_id للصنف الفعلي،وreceived_by لاسم الموظف المستلم. purchase_receipt_items ترتبطبالسند بمفتاحpurchase_receipt_id في موضعين (تفاصيلPO وقائمةالسندات)،لاoperation_chain الذييسقطlegacyNULLoperation_id. لاaliasغيرمستهلك أوعمودإضافي. خمس hints لأربعسلاسل،وبقيةASTلكلملفمطابقةلبصمة204f1ed قبلالتصحيح.', '',
  'المقارنةقبلالمنحعلى138 محفوظة فيTABLE_ACCESS_DIAGNOSTIC.json؛يبقى اختبار42501 السلبي قائماً. العقد الجديد لايُعدّيأخطاءSQLأوPostgREST،ولاينقصتغطيةالأدوار/الصفحات. --require-access يبني150 ولايصللمشروعحقيقي. المصادقةوStorageوRealtimeوالإعداداليدويمازالتبواباتstaging منفصلة.', '',
 ];
 await writeFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_150.md'),lines.join('\n')+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const {inventory,writeInventory}=await import('./table-access-inventory.mjs');
 const evidence=JSON.parse(await readFile(process.argv[2],'utf8')),source=await inventory();
 assert.equal(evidence.infrastructureOk,true,'DIAGNOSTIC_INCOMPLETE');assert.deepEqual(evidence.sourceHashes,source.sources,'STALE_SOURCE_EVIDENCE');
 await writeInventory(source);
 if(evidence.migrationCeiling===150)await saveAfter150(source,evidence);else await saveReport(source,evidence);
 console.log(JSON.stringify({ok:true,counts:evidence.counts}));
}
