# استعادة العمل — 9 نوفمبر2026

السبب مثبت بسجل Codex المحلي، وليس فرضية Docker: startup-cleanup عند10:59:40UTC اختار worktree كـdelete-candidate مع ownerThreadInProgress=false، ثم git-remove-result success=true عند10:59:52. بعد حذف Git فشلت إزالة مجلد العمل بـEBUSY، فبقيت junctions الاعتماديات فقط. حفظ التطبيق لقطة292b8689 قبل الإزالة، واستُعيدت فوقb305421c بلا تغييرmain، ودُفعت علىcodex/sales-only-phase2.

مجلد التعافي sales-only-phase2-recovery؛ المصدر القديم لم يُحذف أو يجتزjunction. وُضع Git worktree lock، دون تغيير إعدادات التطبيق العامة؛ لا ادعاء أنه ضمان ضد أداة تستخدمforce مرتين. اعتماد المالك: commit/push بعد كل خطوة مهمة وعلى الأقل نحو ساعة. دليل حذف التطبيق محفوظ خارج المستودع فيWORKTREE_CLEANUP_LOG_EVIDENCE.json؛ لم تُحفظ أسرار.

راجعنا bootstrap-isolated-supabase: الحذف فيه لحاويات مشروع الاختبار والمهاجرات في مجلدtemporaryRoot المنفصل فقط، وfinally في فاحصنا ينفذsupabase stop --workdir local --no-backup بعد تحققID/label؛ لا أمر حذفworktree في المسار المنفذ. لا تغيير لأدوات الإنتاج.

تعثر الاختبار السابق قبل التسليم بـLITE1_ORDER_STATE: fixture أبقتpreparing بينما الكاتب النموذجي يقبلnew فقط. صُحح الاختبار بفحصpreparing داخلtransaction تُلغى، دون تعديل الكاتب أو جسر آخر. لا تُحسب المحاولة السابقة نجاحاً كاملاً.


## تكرار التنظيف بعد القفل

عند11:38:35–11:38:40UTC تكرر startup-cleanup علىsales-only-phase2-recovery رغم قفلGit. حفظ لقطةab62527e ثم فشلgit remove بالرمز128، ومع ذلك تلاها حذف ملفات وانتهىEBUSY عندrmdir. لذلك قفلGit لم يمنع أداة التنظيف المُدارة. استُعيدت اللقطة كاملة ودُفعت إلىcodex/sales-only-phase2؛ لا عمل مفقود.

الموضع الحالي خارج جذرCodex-managed worktrees: `C:/Users/TOP/NawasrahWorktrees/sales-only-phase2/mahdi-admin`، worktreeGit مستقل على الفرع نفسه، مقفول أيضاً. لا تعديل لإعدادات التطبيق أو حذف مجلدات قديمة أو اجتيازjunction، ولا تغييرmain أو.envالمالك. بياناتGit للمجلد القديم المحذوف ما زالت محفوظة؛ عند ربط الفرع بالمجلد الجديد استُخدمignore-other-worktrees بعد التأكد أن القديم بلا.gitوبلاكاتبنشط،دونمسحmetadataأوغيره.

آخرنتيجةقبلالتنظيفمحفوظةخارجياً:POS_RECOVERY_PASS.json،وفيها16حالةبيعوسباقالحفظ/الإلغاءوفحصسلامة0،شبكة0وتنظيفناجح. كذلكCOMMERCIAL_ACTOR_CONTEXT_PASS.jsonيثبت18مقارنةبعدإضافةسياقحارسOWNER_PILOTللنسخةالخاصةالجديدة.
