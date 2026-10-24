import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {root,baseline} from './context.mjs';
const directory=path.join(root,'docs/operations/pre-handover-evidence');
const load=async n=>JSON.parse(await readFile(path.join(directory,n+'.json'),'utf8'));
const findings=[
 {id:'H03',severity:'high',title:'استلام مخزون قديم بلا سند أو تكلفة شراء أو ذمة، وتكراره يزيد الكمية مرة ثانية',evidence:['legacy-receive.json']},
 {id:'H01',severity:'high',title:'النسخ المعتمد في الكود مقيد بالمشروع القديم؛ لا يثبت حماية فرانكفورت',evidence:['scripts/backup/backup-public-config.mjs','scheduled-tasks.json','offsite-status.json']},
 {id:'H02',severity:'high',title:'Vite6.4.3 المتأثر على Windows مع استماع التطوير لكل الشبكات',evidence:['npm-admin.json','npm-store.json','package.json','customer-web/package.json']},
 {id:'M01',severity:'medium',title:'التقرير السنوي يستغرق36–38ثانية عند50000فاتورة',evidence:['long-period.json']},
 {id:'M02',severity:'medium',title:'جاهزية حارس وإشعارات وجدولة فرانكفورت غير مثبتة بالأدلة المحلية',evidence:['scheduled-tasks.json','local-statuses.json','offsite-status.json']},
 {id:'L01',severity:'low',title:'غياب lockfile لاعتمادات Edge يحد قابلية إعادة إنتاج audit',evidence:['npm-edge.json']},
];
const evidence={schemaVersion:1,baseline,migrationCeiling:212,createdAt:new Date().toISOString(),managedAccess:false,deployment:false,productFixes:false,findings,counts:{critical:0,high:3,medium:2,low:1},golden:{steps:31,semanticChecks:18,ok:(await load('golden-day-independent-verification')).ok},adversarial:{cases:(await load('adversarial')).cases.length,ok:(await load('adversarial')).ok},legacy:{cases:10,confirmedFinding:(await load('legacy-receive')).confirmedFinding},costDifference:{checks:9,ok:(await load('cost-difference')).ok},performance:(await load('performance')).results.map(r=>({name:r.name,ok:r.ok,...r.summary})),environment:{postgres:17,dockerCpus:12,dockerMemoryBytes:8181657600},ci:{status:'see PR22 exact-head FULL quality and secrets checks'},files:[]};
for(const file of (await readdir(directory)).filter(f=>f.endsWith('.json')).sort()){const bytes=await readFile(path.join(directory,file));evidence.files.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile(path.join(root,'docs/operations/PREHANDOVER_AUDIT_EVIDENCE.json'),JSON.stringify(evidence,null,2)+'\n');
const exposure=await load('exposure'),dependencies=await load('exposure-dependencies');
const functions=dependencies.rows.map(r=>`| ${r.signature} | ${r.roles.join(', ')} | ${r.returnType==='trigger'?'محفّز':r.sqlCallCandidates.length?'اعتماد SQL مرشح':r.policyCandidates.length?'اعتماد سياسة':'مراجعة مستقلة'} | ${r.sqlCallCandidates.length}/${r.policyCandidates.length}/${r.triggers.length} |`).join('\n');
const relations=exposure.relations.filter(r=>r.reviewRequired).map(r=>`| ${r.name} | ${r.kind} | ${r.rls?'نعم':'لا'} | ${(r.acl??[]).filter(a=>['PUBLIC','anon','authenticated','service_role'].includes(a.grantee)).map(a=>a.grantee+':'+a.privilege).join('؛ ')} |`).join('\n');
await writeFile(path.join(root,'docs/operations/UNEXPOSED_RPC_REVIEW_AR.md'),`# جرد المسارات بلا استدعاء مباشر — مرجع212

24 أكتوبر2026، main d72f709. جرد قاعدة PostgreSQL17 محلية فعلية بعد174migration ومصدر الإدارة والمتجر وEdge عبر محلل TypeScript. لا تعديل منح ولا اتصال مستضاف.

556دالة؛220توقيعاً متاحاً لأحد anon/authenticated/service_role، بما فيها PUBLIC الضمنية. منها41 بلا RPC مباشر، و6 منها trigger.119علاقة تشمل الجداول والعروض والتسلسلات؛67 ذات منحة عميل وبلا وصول جدول مباشر ظاهر في المصدر.

الدليل الكامل: [الجرد](pre-handover-evidence/exposure.json) و[التبعيات](pre-handover-evidence/exposure-dependencies.json). يتضمن المالك وACL وRLS والسياسات وتواقيع overloads وبصمات المصدر. المطابقة النصية للدعوات الداخلية مرشح مراجعة وليست callgraph كاملة. غياب استدعاء مباشر لا يجيز حذفاً أو سحب منحة.

## الدوال41

آخر عمود: عدد مراجع SQL / السياسات / المحفزات المرشحة.

| التوقيع | أدوار التنفيذ | التصنيف | SQL/سياسة/محفز |
|---|---|---|---|
${functions}

## العلاقات67

المنحة لا تتجاوز RLS تلقائياً. يجب التفريق بين SELECT وDML والتسلسلات.

| العلاقة | النوع PostgreSQL | RLS | المنح |
|---|---|---|---|
${relations}

## إثبات المسارات القديمة في212

- create_customer_order: صنف طرد فقط عبر المسار القديم رفض PARCEL209_LEGACY_PARCEL_EVIDENCE_REQUIRED، دون تغيير أي جدول أو تسلسل.
- submit_guest_customer_order بدورservice_role: الرفض نفسه وبلا أثر.
- create_pos_sale V1: رفض PACKAGE_D_POS_V2_REQUIRED وبلا أثر؛ لا منحة عميل فعالة في الجرد الحالي.
- POSv2: رفض بيع الوحدة لصنف طرد فقط عند كميات1و10و20؛ مضاعفات حجم الطرد لا تتجاوز نوع السطر.
- aftercare_supplier_links وsupplier_replacement_inventory_effects: رفض القراءة المباشرة لأدوارanon/authenticated/service_role.
- **receive_inventory: خلل مثبت H03.** يقبل زيادة5وحدات بمرجع شراء غير موجود، بلا سند أو ذمة جديدة؛ تكرار الاستدعاء يضيف5أخرى. ثبت للأدوارowner/admin/manager/warehouse_keeper، ورفض بقية الأدوار الستة. الدليل [legacy-receive.json](pre-handover-evidence/legacy-receive.json)، دون إصلاح.

الدليل [adversarial.json](pre-handover-evidence/adversarial.json). بقية التواقيع جُردت مع تبعياتها المرشحة؛ لا ندعي أن كل توقيع خضع لمحاولة هجومية مستقلة بمدخلات أعمال صحيحة. لا سحب جماعي مقترح؛ المسارات القديمة مثل receive_inventory وreceive_purchase_order وكتّاب المنتجات تحتاج مراجعة عقد ومستهلك داخلي منفصلة قبل أي تغيير صلاحيات.
`);
console.log(JSON.stringify({files:evidence.files.length,findings:evidence.counts}));
