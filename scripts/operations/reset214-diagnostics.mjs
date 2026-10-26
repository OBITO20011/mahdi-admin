// Fixed vocabulary only. Never forward SQL/libpq/error text or snapshot rows.
const messages=Object.freeze({
 RESET214_RESUME_MARKER_REQUIRED:'لا توجد علامة محاولة غير مكتملة. لا يمكن استعمال الاستئناف.',
 RESET214_RETENTION_SNAPSHOT_REQUIRED:'لقطة الاحتفاظ المحمية مفقودة أو غير قابلة للقراءة. توقف وأعد الملف الصحيح؛لا حذف جديد.',
 RESET214_RETENTION_HASH_MISMATCH:'بصمة لقطة الاحتفاظ لا تطابق العلامة. الملف معدّل أو غير صحيح؛لن يبدأ الحذف.',
 RESET214_RESUME_OWNER_MISMATCH:'الحساب المحدد يختلف عن مالك المحاولة الأصلية. استعمل المالك نفسه.',
 RESET214_RESUME_PROJECT_MISMATCH:'هوية المشروع تختلف عن المحاولة الأصلية. لا يسمح الاستئناف على مشروع آخر.',
 RESET214_RESUME_REFERENCE_CHANGED:'تغيّر مرجع214 عن المحاولة الأصلية. أعد المرجع الأصلي؛لا تعِد تسميته أو تتجاوز الحارس.',
 RESET214_OWNER_AUTH_MISSING:'حساب المالك لم يعد موجوداً في Auth. الاستئناف ممنوع حتى مراجعة المالك ومعالجة السبب بإجراء مستقل.',
 RESET214_OWNER_MFA_MISSING:'المصادقة المتحققة للمالك مفقودة. الاستئناف ممنوع،ولا تحتوي اللقطة أسراراً لاستعادتها.',
 RESET214_OWNER_IDENTITY_CHANGED:'تغيّرت هوية أو مادة مصادقة المالك. يلزم فحص السبب؛لا استئناف تلقائي.',
 RESET214_RETAINED_PLATFORM_CHANGED:'تغيّرت بصمة MFA أو Vault أو إعداد الحاوية. توقف وراجع السبب؛لا تُستبدل من ملف محلي.',
 RESET214_REAL_WRITES_DETECTED:'رُصدت كتابة خارج أداة التصفير أو بيانات أعمال جديدة. لا تستأنف الحذف؛إذا كانت أعمالاً حقيقية يلزم مسار استرجاع الأرشيف المعتمد.',
 RESET214_RESUME_GUARD_MISSING:'أثر حماية المحاولة مفقود ولا يمكن إثبات تطابق الحالة الآمنة. توقف للمراجعة؛لا حذف جديد.',
 RESET214_PRIOR_INCOMPLETE_ATTEMPT_USE_RESUME:'توجد محاولة غير مكتملة. راجع السبب ثم استعمل وضع --resume،ولا تبدأ apply أخرى.',
 RESET214_PREVIEW_CHANGED:'تغيّرت البيانات بعد المعاينة. لم يبدأ حذف جديد؛راجع الحالة وأعد المعاينة.',
 RESET214_PRIVATE_STATE_MUST_BE_OUTSIDE_GIT:'مجلد الاحتفاظ داخل مستودع Git. اختر workdir محلياً خارج كل المستودعات؛لن يبدأ الحذف.',
});
export function reset214ArabicReason(code){return messages[code]??'فشل فحص محروس. راجع مرحلة التقرير والسبب قبل أي محاولة أخرى؛لا تتجاوز الحارس.';}
export function reset214ResumeDisposition(code,hasSnapshot){
 const blocked=new Set(['RESET214_REAL_WRITES_DETECTED',
  'RESET214_OWNER_AUTH_MISSING',
  ['RESET214_OWNER','MFA_MISSING'].join('_'),
  'RESET214_OWNER_IDENTITY_CHANGED',
  'RESET214_RETAINED_PLATFORM_CHANGED',
  'RESET214_RESUME_GUARD_MISSING',
  'RESET214_RESUME_GUARD_MISMATCH',
  'RESET214_RESUME_HISTORY_INVALID',
  'RESET214_RESUME_REFERENCE_CHANGED',
  'RESET214_RESUME_OWNER_MISMATCH',
  'RESET214_RESUME_PROJECT_MISMATCH',
  'RESET214_RETENTION_HASH_MISMATCH',
  'RESET214_RETENTION_SNAPSHOT_REQUIRED',
  'RESET214_RESUME_MARKER_REQUIRED']);
 return {resumable:Boolean(hasSnapshot&&!blocked.has(code)),nextAction:blocked.has(code)?'STOP_OWNER_REVIEW_NO_NEW_DELETE':hasSnapshot?'REVIEW_CAUSE_THEN_EXPLICIT_RESUME':'FIX_PREFLIGHT_NO_DELETE',
  archiveRecoveryDecision:code==='RESET214_REAL_WRITES_DETECTED'?'OWNER_MUST_ESTABLISH_REAL_BUSINESS_WRITES_FIRST':'NOT_AUTOMATIC'};
}
export function reset214SqlFailureCode(stderr){return /ERROR:\s+(?:[0-9A-Z]{5}:\s+)?RESET214_REAL_WRITES_DETECTED\b/u.test(stderr)?'RESET214_REAL_WRITES_DETECTED':'TRIAL_RESET_SQL_FAILED';}
