# Phase 6 — خطة تحسين الواجهة قبل التسليم

الحالة: **Phase 6 = OWNER-CLOSED** بتاريخ 2026-10-07. اعتمد المالك الحزم (أ)، (ب)، (ج) وتصحيح ب+ج عند `5aaeab11e13c2be454af677ee176f77aa2d9cde4`؛ CI لهذا SHA ناجح: code quality `37531634141` وsecret scanning `37531634136`. الحزمة (د) مصرح لها بالتخطيط فقط، وPhase 7 لم تبدأ.

Baseline: `5ff442a2b0adecd138707981abf86634b06f1937` على `main` وremote.
إغلاق Phase 5 معتمد؛ CI لهذا commit ناجح: quality `37409929086` وsecret scanning `37409929112`.

القائمة مبنية على قراءة شاشات Admin والمتجر ومسارات قراءة التقارير في المصدر.
هذه القائمة سجل تشخيص المصدر الأولي. أدلة تنفيذ الحزمة (أ) والتحقق منها تسجل عند اكتمالها.
الحجم تقدير نسبي للتغيير والفحص، وليس وعدًا زمنيًا. الترتيب حسب أثره على عمل المحل.

## قائمة واحدة — 19 بندًا

| # | المشكلة المثبتة | الملف / الدليل | الحل المقترح | الحجم |
| --- | --- | --- | --- | --- |
| 1 | **المؤجل: التقارير التشغيلية والملخصات اليومية لا تغطي مرتجعات Phase 4 الحديثة**؛ التقرير ما زال يقرأ مسار Legacy والملخص يجمع `sales_returns` فقط. | [reports.service.ts](C:/Users/TOP/mahdi-admin/src/services/supabase/reports.service.ts:42)، [078](C:/Users/TOP/mahdi-admin/supabase/migrations/078_operational_accounting_integrity.sql:59)، [055](C:/Users/TOP/mahdi-admin/supabase/migrations/055_operational_business_reports.sql:117)، [098](C:/Users/TOP/mahdi-admin/supabase/migrations/098_business_summaries.sql:256)، [ReportsCenterView.tsx](C:/Users/TOP/mahdi-admin/src/features/reports/ReportsCenterView.tsx:119). | تصحيح **القراءة الفعلية** للتقارير والملخصات من الحقائق المسوّاة القديمة والحديثة دون العد المزدوج. فصل الإيراد عن التحصيل وخفض الذمة والاسترداد النقدي، وإظهار نطاق التقرير بوضوح. الحفاظ على COGS الأصلي وتكلفة الاستبدال واسترداد تكلفة المخزون كأبعاد منفصلة. إن تعذر توفير قراءة صحيحة، لا نعرض التقرير الناقص كأنه كامل. | كبير |
| 2 | **L10: تقرير الإغلاق يصنّف حدث المرتجع كله تالفًا إذا وجد صنف تالف واحد**؛ لا يبيّن كميات المكونات السليمة/المعيبة/ضرر العميل. | [128](C:/Users/TOP/mahdi-admin/supabase/migrations/128_phase5_operational_payment_and_shift_refund_fixes.sql:129)، [ShiftClosingReportModal.tsx](C:/Users/TOP/mahdi-admin/src/features/shifts/ShiftClosingReportModal.tsx). | إضافة تفصيل كميات على مستوى الأصناف/المكونات من evidence القائمة، مع إبقاء مبلغ الاسترداد الإجمالي على مستوى الحدث؛ لا ننسب كامل المال للتلف ولا نخترع توزيعًا ماليًا لكل قطعة. حفظ ثبات لقطات الإغلاق التاريخية وتمييز التفصيل غير المتوفر. | متوسط |
| 3 | شاشة مرتجع الوحدة الأساسية تستخدم **كل الكمية المتبقية** في `buildReturn` ولا تعرض اختيار كمية، رغم دعم العقد الحالي للمرتجع الجزئي. | [AdminAftercarePanel.tsx](C:/Users/TOP/mahdi-admin/src/features/orders/AdminAftercarePanel.tsx:136). | إدخال كمية للوحدة الأساسية فقط، مع عرض المتبقي وتوزيع physical sources الصحيح عبر الـRPC الحالي. تبقى الطرود مرتجعًا كاملًا؛ لا تغيير لقاعدة الاستحقاق أو الهوية. | متوسط |
| 4 | الموظف يرى «صنف أساسي» و«المكوّن 1» وأزرارًا متشابهة دون اسم الصنف؛ وتظهر مصطلحات `Phase 4` و`Parcel` و«الممثل الفيزيائي». | [AdminAftercarePanel.tsx](C:/Users/TOP/mahdi-admin/src/features/orders/AdminAftercarePanel.tsx:249). | عرض اسم الصنف/النكهة والكمية وهوية الطرد أو البديل الحالي من بيانات القراءة المعتمدة، وتسميات عربية مثل «القطعة الحالية» و«مرتجع الطرد». الحفاظ على IDs والسلسلة التاريخية وعدم استنتاج سعر أو تكلفة جديدة. | متوسط |
| 5 | نافذة سند القبض تعرض بطاقة/تحويلًا بنكيًا/شيكًا إضافة إلى Cash/CliQ، خلاف نطاق المحل المعتمد؛ المرجع موسوم «اختياري» لكل الطرق. | [RecordCustomerPaymentModal.tsx](C:/Users/TOP/mahdi-admin/src/features/accounts/RecordCustomerPaymentModal.tsx:256)، [customerAccounts.service.ts](C:/Users/TOP/mahdi-admin/src/services/supabase/customerAccounts.service.ts:105). | قصر **الاختيارات الجديدة في UI** على Cash/CliQ وتوضيح متطلبات مرجع CliQ وفق العقد المعتمد. إبقاء عرض الوسائل التاريخية إن وجدت؛ لا حذف بيانات أو تغيير ACL/عقد DB ضمن تعديل واجهة غير مصرح. | متوسط |
| 6 | دقة العملة غير متسقة: بطاقات الإدارة تبدأ بدقتين، الطلبات المختصرة تستخدم `toFixed(2)`، والمتجر وتقارير أخرى تعرض ثلاثًا. | [KpiCards.tsx](C:/Users/TOP/mahdi-admin/src/features/dashboard/KpiCards.tsx:45)، [WidgetsSection.tsx](C:/Users/TOP/mahdi-admin/src/features/dashboard/WidgetsSection.tsx:105)، [money.ts](C:/Users/TOP/mahdi-admin/customer-web/src/utils/money.ts:1). | توحيد عرض الدينار بثلاث منازل للمبالغ التشغيلية والتقارير، مع تحديد هل المدخل JOD أم minor units. الحفاظ على الإشارات السالبة في الربح والفروق؛ لا إعادة استخدام formatter يصفّر السالب ولا تغيير حسابات DB. | متوسط |
| 7 | أخطاء RPC/recovery تُعرض مباشرة بـ`error.message`؛ يوجد مثال ظاهر يبدأ بـ`PHASE43_RETURN_ALLOCATION_INVALID`. | [AdminAftercarePanel.tsx](C:/Users/TOP/mahdi-admin/src/features/orders/AdminAftercarePanel.tsx:186)، [customerAccounts.service.ts](C:/Users/TOP/mahdi-admin/src/services/supabase/customerAccounts.service.ts:143)، [CheckoutModal.tsx](C:/Users/TOP/mahdi-admin/customer-web/src/components/CheckoutModal.tsx:660). | ترجمة الأكواد المعروفة إلى سبب عربي وخطوة آمنة للموظف/الزبون، مع fallback واضح للأخطاء غير المعروفة. لا تحويل timeout إلى رفض قطعي ولا تشجيع إنشاء مفتاح جديد للمحاولة المجهولة. | متوسط |
| 8 | الإدارة تبدأ على الكمبيوتر داخل إطار هاتف بعرض 420px وارتفاع ثابت 880px، فيضيّق POS والتقارير والنماذج. | [IPhoneContainer.tsx](C:/Users/TOP/mahdi-admin/src/components/layout/IPhoneContainer.tsx:238). | جعل وضع الاستخدام الحقيقي responsive افتراضيًا على الكمبيوتر والتابلت؛ إبقاء إطار الهاتف للمعاينة فقط إن لزم. الحفاظ على قفل الجلسة وإخفاء المحتوى المحمي وsafe areas. | متوسط |
| 9 | Modal الإدارة المشتركة بلا `role=dialog` أو `aria-modal` وربط عنوان؛ ولا إدارة focus/Tab/Escape/استعادة التركيز. | [Modal.tsx](C:/Users/TOP/mahdi-admin/src/components/common/Modal.tsx:27). | تحسين المكوّن الحالي نفسه: semantics والعنوان، حصر التركيز وإعادته وإغلاق مدروس، مع احترام منع الإغلاق أثناء العمليات الحساسة. لا تغيير صلاحيات الأفعال. | متوسط |
| 10 | Cart/Checkout في المتجر لديهما dialog semantics لكن لا إدارة keyboard focus؛ تفاصيل المنتج تغلق بـEscape بينما السلة/Checkout لا تملكان معالجة مكافئة. | [CartDrawer.tsx](C:/Users/TOP/mahdi-admin/customer-web/src/components/CartDrawer.tsx:136)، [CheckoutModal.tsx](C:/Users/TOP/mahdi-admin/customer-web/src/components/CheckoutModal.tsx:715)، [ProductDetailsModal.tsx](C:/Users/TOP/mahdi-admin/customer-web/src/components/ProductDetailsModal.tsx:123). | توحيد سلوك التركيز والتنقل والإغلاق في النوافذ الموجودة، وحماية nested dialogs. Escape لا يلغي محاولة معلقة ولا يتجاوز قيود الإرسال أو recovery. | متوسط |
| 11 | بطاقات إضافة المنتج في POS وبطاقات تنبيه المخزون بالـDashboard تستخدم `div onClick` دون وصول لوحة مفاتيح. | [PosView.tsx](C:/Users/TOP/mahdi-admin/src/features/pos/PosView.tsx:640)، [KpiCards.tsx](C:/Users/TOP/mahdi-admin/src/features/dashboard/KpiCards.tsx:171). | عناصر button أو semantics مكافئة مع Enter/Space وfocus واضح؛ إبقاء نفس action والتحقق من المخزون، دون إضافة طلبات مكررة. | صغير |
| 12 | تصنيف مكونات المرتجع ثلاثي الأعمدة بخط 9px وحقول صغيرة، وأزرار الشريط العلوي 32px؛ صعب القراءة واللمس. | [AdminAftercarePanel.tsx](C:/Users/TOP/mahdi-admin/src/features/orders/AdminAftercarePanel.tsx:355)، [Header.tsx](C:/Users/TOP/mahdi-admin/src/components/common/Header.tsx:141). | تحسين حد حجم النص/اللمس، وكسر الأعمدة عند العرض الضيق، وإظهار مجموع التصنيف مقابل كمية المكوّن. لا تغيير conservation أو أسباب ضرر العميل. | متوسط |
| 13 | أرقام الطلبات/الإيصالات المعروضة داخل RTL ليست معزولة الاتجاه بشكل متسق؛ بعض المواضع لديها `dir=ltr` وأخرى font-mono فقط. | [OrderDetailModal.tsx](C:/Users/TOP/mahdi-admin/src/features/orders/OrderDetailModal.tsx:409)، [CheckoutReceiptPanel.tsx](C:/Users/TOP/mahdi-admin/customer-web/src/components/CheckoutReceiptPanel.tsx:51). | عزل أرقام السند والطلب والمرجع والهاتف بـ`bdi`/`dir=ltr` في العرض والنسخ والطباعة. النص العربي يبقى RTL، والهوية المنسوخة لا تتغير. | صغير |
| 14 | labels منفصلة في نموذج سند القبض بلا `htmlFor/id`؛ وبعض أزرار Header الأيقونية بلا اسم وصول واضح. | [RecordCustomerPaymentModal.tsx](C:/Users/TOP/mahdi-admin/src/features/accounts/RecordCustomerPaymentModal.tsx:234)، [Header.tsx](C:/Users/TOP/mahdi-admin/src/components/common/Header.tsx:138). | ربط الحقول بعناوينها وإضافة أسماء عربية للأيقونات؛ focus/error/help states متسقة في المكوّنات الحالية. | صغير |
| 15 | Checkout يعرض النجمة وخطأ الحقل بصريًا، لكن wrapper لا يربط الخطأ بـ`aria-describedby` ولا حالة `aria-invalid/required`. | [CheckoutModal.tsx](C:/Users/TOP/mahdi-admin/customer-web/src/components/CheckoutModal.tsx:111). | ربط وصف الخطأ بالمدخل والإعلان عن نتيجة التحقق والتركيز على أول خطأ مناسب. العنوان والتوصيل يبقيان مطلوبين ولا تتغير مرحلة Review أو Turnstile. | متوسط |
| 16 | ملخص السلة/Checkout يسمّي مجموع جميع line quantities «طرودًا» رغم وجود `base_unit` في نفس نموذج السلة. | [cart.ts](C:/Users/TOP/mahdi-admin/customer-web/src/utils/cart.ts:384)، [CartDrawer.tsx](C:/Users/TOP/mahdi-admin/customer-web/src/components/CartDrawer.tsx:151)، [CheckoutModal.tsx](C:/Users/TOP/mahdi-admin/customer-web/src/components/CheckoutModal.tsx:752). | عرض عدّين واضحين: طرود ووحدات أساسية، مع تسميات السطور الصحيحة. لا تغيير الكميات التجارية أو serialization أو payload المرسل. | صغير |
| 17 | المنتجات تعرض «متصل ومحدّث» لمجرد عدم وجود error حتى قبل اكتمال التحميل؛ بحث سند القبض الخالي قد يعرض «كل الطلبات مدفوعة» رغم أنه نتيجة بحث فقط. | [ProductsView.tsx](C:/Users/TOP/mahdi-admin/src/features/products/ProductsView.tsx:215)، [RecordCustomerPaymentModal.tsx](C:/Users/TOP/mahdi-admin/src/features/accounts/RecordCustomerPaymentModal.tsx:140). | فصل loading/آخر تحديث ناجح/فشل/لا نتائج بحث/لا ذمم فعلية. إبقاء retry وإظهار مصدر الحالة، دون تحويل فشل القراءة إلى صفر مالي. | صغير |
| 18 | `select-none` مطبق على غلاف الإدارة كله، فيمنع تحديد أرقام السند والمرجع لنسخها أثناء العمل. | [IPhoneContainer.tsx](C:/Users/TOP/mahdi-admin/src/components/layout/IPhoneContainer.tsx:232). | حصر منع التحديد في controls المناسبة؛ إتاحة تحديد النص وأزرار نسخ للهوية التشغيلية، دون نسخ بيانات حساسة غير لازمة. | صغير |
| 19 | نفس وجهة accounts تسمى «العملاء» في BottomTabs و«العملاء والذمم» في المزيد؛ Header يعرض role الخام بدل الاسم العربي. | [BottomTabs.tsx](C:/Users/TOP/mahdi-admin/src/components/layout/BottomTabs.tsx:50)، [adminNavigation.config.ts](C:/Users/TOP/mahdi-admin/src/features/more/adminNavigation.config.ts:112)، [Header.tsx](C:/Users/TOP/mahdi-admin/src/components/common/Header.tsx:164). | توحيد تسمية الوجهة وتعريب اسم الدور على مستوى العرض فقط، مع المحافظة على مجموعات التنقل الحالية وصلاحيات owner/manager/cashier. لا إعادة تصميم navigation كاملة. | صغير |

## ترتيب التنفيذ المعتمد من المالك

- الحزمة (أ) — أرقام ومصاري صح: **1، 2، 5، 6، 17**. صفحة [نطاق التقارير](C:/Users/TOP/mahdi-admin/docs/agent/PHASE6_A_REPORTS_SCOPE.md) ومثال القبول معتمدان؛ التنفيذ والتحقق معتمدان.
- الحزمة (ب) — شغل الموظف اليومي: **3، 4، 7، 8، 12، 13، 16، 18، 19**.
- الحزمة (ج) — تحسينات الوصول: **9، 10، 11، 14، 15**.
- البند 8: **شكل الموبايل يبقى كما هو بالضبط؛ التحسين للكمبيوتر والتابلت فقط**.
- كل حزمة تنتهي باختبارات، Gitleaks exit 0 قبل commit، commit/push وCI ناجح على نفس SHA، ثم توقف لموافقة الحزمة التالية.
- ملف الخطة يدخل أول commit للحزمة (أ).

## حدود التنفيذ المعتمدة

- لا private/inactive layers جديدة؛ التحسين يكون على الشاشة أو القارئ الفعلي.
- البندان 1 و2 تصحيح **قراءة/تفصيل تقارير** في Migration 131 واحدة معتمدة؛ migrations 001–130 لا تُعدل، ولا writers/grants/لقطات تاريخية.
- L9 (`create_customer_order.p_source`) يبقى قرارًا منفصلًا؛ لا نضيّق RPC عامة ضمن خطة UI.
- لا نغير أسعارًا أو WAC أو COGS أو استحقاق مرتجع أو tender أو قواعد recovery أو صلاحيات لإصلاح العرض.
- لا Production ولا deploy ولا Phase 7، ولا بدء الحزمة التالية قبل موافقة المالك.

## طريقة التحقق المقترحة

فحص مركز لكل مجموعة مرتبطة أثناء التنفيذ، مع أسماء/كميات متعددة وCash/CliQ
وحالات mixed return. اختبارات keyboard وRTL وعرض 360px/تابلت/كمبيوتر، مع
Chromium وMobile WebKit في البيئة المعزولة وProduction requests = 0.
البيانات المالية المتوقعة تأتي من RPC/evidence معتمدة، لا من mocks لإثبات المال.
تشغيل quality مرة عند اكتمال الحزمة، ثم مراجعة نهائية قبل بوابة التسليم؛ لا تكرار
Canonical/rebuild لمجرد تغيير نص أو CSS دون سبب متعلق بالبيانات.

**الحالة الحالية:** تصحيح Claude للحزمة (أ) عند `0b31eec0949519eefdac398dd6a034f956d0b5f9`
اجتاز push/main code quality (`37428026149`) وفحص الأسرار (`37428026040`).
المالك أجاز الحزمة (ج) بعد نجاح CI للحزمة (ب) عند `b3eda6fffe2cd68e12e5464647bafd3ed75bee46`.

## دليل الحزمة (أ) المحلي

- DB فعلية معزولة: 001–130 يثبت إغفال المرتجع الحديث؛ 001–131 يصححه.
  مثال 11 / تحصيل CliQ 6 / مرتجع 5 يعطي صافي بيع 6، ذمة 1، Cash −1 وCliQ +6.
- Legacy وحديث في الفترة نفسها دون تكرار؛ سند الإكمال يحسب مرة واحدة.
- تكلفة بديل 111.111111 minor units تبقى مصدر الاسترجاع رغم WAC 999 وسعر 7777؛ COGS الأصلي ثابت.
- كميات الإغلاق المختلطة 1 سليم + 1 معيب (+ 1 ضرر عميل في المكوّن الثاني) محفوظة مستقلًا عن مبلغ الرد؛ لقطة الإغلاق ثابتة.
- دوال الكتابة والصلاحيات الأخرى مطابقة لـ001–130؛ قراءات التقارير صفر كتابة، DB lint PASS.
- Migration 131 candidate canonical LF SHA-256: `F0CA79A2AAEED327B865884982D1D52BFCD72899AD2282DE4A59F55FACFBEEE9`.
- CI لأول commit `dc4ab2910e30fc357276facb4f0c359daf398e41` كشف إسقاط حقول الخصم القديمة بسبب أولوية عامل دمج JSON.
  صحّحت أقواس الدمج داخل القارئ 131 المرشح نفسه، دون migration ثانية/writers؛ فحص الحقول القديمة وخصم فعلي 1 minor unit نجح على DB جديدة.
  تجاوزت إعادة Phase3 المحلية فحص التقارير، لكنها تعثّرت لاحقًا عند حاجز `p3-complete-5 / p3-expire-5`؛ ليست PASS كاملة.
  لم تُعدل writers أو اختبارات الأقفال أو timeouts. نجاح DB CI كاملة على SHA المصحح شرط التسليم، لا يُستبدل بالفحص المالي المركز.
- تحقق الحزمة: Admin 678/678، المتجر 189/189، TypeScript وESLint strict وDB lint وquality PASS.
- Browser QA الأولى: 216 passed، 51 conditional skips موجودة مسبقًا، واختبار قديم flaky مرة واحدة؛ الفحص المركز اللاحق دون retries: 12/12 PASS.
  quality على التصحيح: 217 passed، 51 conditional skips، بلا retries أو flaky. Admin 678/678 والمتجر 189/189.
- عزل المتصفح: external/Production requests escaped = 0. موارد DB والمتصفح المحلية أوقفت بعد الفحص.
- لا Production/deploy؛ البند 8 وتغييرات إطار الموبايل خارج هذه الحزمة.

## الحزمة (ب) — نطاق التنفيذ والفحص

- 3: كمية صحيحة للوحدة الأساسية (1..المتبقي)، موزعة على هويات القطع الحالية؛ الطرد كامل فقط.
- 4/12: أسماء من الطلب/تركيبه التاريخي، الأصل/البديل الحالي، هوية الطرد، مجموع التصنيفات وحقول لمس أوضح.
- 7: رسائل عربية في العرض؛ adapter وتصنيف UNKNOWN/recovery لا يتغيران.
- 8/18: الكمبيوتر والتابلت يستعملان عرض الشاشة؛ `?preview=phone` للمعاينة فقط. قواعد العرض الأصغر من 768px والـsafe areas وقفل الجلسة محفوظة، وتحديد النص متاح.
- 13: عزل أرقام الطلب والسند والمرجع والهاتف بـ`bdi dir=ltr`، دون تغيير الهوية أو النص المنسوخ.
- 16: عدّ الطرود والوحدات الأساسية منفصل في السلة/Checkout؛ الـpayload والكميات والحسابات لا تتغير.
- 19: «العملاء والذمم» في نفس وجهة التنقل، والأدوار بالعربية دون تغيير الصلاحيات.
- الفحص: تخصيص كمية/هويات وحدود غير صالحة، مجموع التصنيف، فقد استجابة يبقى قابلًا لاستعادة نفس المحاولة، السلة المختلطة، عرض 390/768/1440 ومعاينة الهاتف؛ Chromium وWebKit بلا retries في الفحص المركز، ثم quality كاملة.
- لا DB/migrations أو Production/deploy. هذه اختبارات واجهة/adapter؛ لا تستبدل أدلة المال وDB السابقة.
- الدليل المحلي: فحص unit/continuity/navigation **15/15**؛ سيناريوهات B على Chromium/WebKit **10/10**؛ fixture اختبار recovery القديم أضيف لها `items` وأعيدت **2/2** بلا retries.
- quality كاملة **PASS**: المتجر 189/189، بناء Admin والمتجر/SEO، 227 browser PASS و51 conditional skips سابقة، بلا retries. فحص عزل Chromium/WebKit: external/Production escaped = 0.
- 001–131 دون تغيير؛ بصمة 131 الحالية `790219C523ECE5EF8F1853F45A0D5775C42509575E5F4E500D06A6DF506F63A1`. لا 132. CI للحزمة B نجح: code quality 37432050153 وsecret scanning 37432050171.

## الحزمة (ج) — النطاق المعتمد

التسليم عند `aab9c5b84fde34e6ab16039a9adf68cc6f77514e` اجتاز quality CI
37509903035 والأسرار 37509903022. المراجعة المستقلة التالية أثبتت خمسة Medium؛
المالك أجاز تصحيح ب+ج في تسعة بنود UI فقط: حماية Escape للتعديلات والإرسال،
summary/Tab، النوافذ المتداخلة، POS/الباركود، تحديث كمية المرتجع قبل الإرسال،
finally لحالات busy، رسائل الخطأ، نسخة focus مستقلة للمتجر، وتواريخ السلسلة.
لا migrations. حراسة كمية المرتجع على الخادم مؤجلة للحزمة د بموافقة منفصلة.

### دليل تصحيح ب+ج — 2026-10-07

- نُفّذت البنود التسعة في المسارات الحالية فقط: Escape للتعديل والإرسال، stack للنوافذ الداخلية والمساعد/التتبع، summary وTab الطبيعي، POS repeat/focus، قراءة كمية جديدة قبل إرسال المرتجع، finally، الرموز والترجمة، نسخة focus مستقلة، ورفض تاريخ بديل أقدم من الأصل/الأب.
- focused unit/continuity **13/13**؛ المجموعة النهائية Chromium/WebKit **32/32** ببيئات معزولة وworkers2/retries0.
- أول quality توقفت عند assertion تاريخية تتطلب Escape محليًا في المساعد. جرى استبدالها بإثبات ربطه بـuseDialogFocus وحراسة النافذة العليا في الآلية المشتركة؛ بقيت assertions الأعمال/الوصول كما هي. اختبارات المتجر **189/189**.
- quality النهائية **PASS**: Admin **688/688**، Customer **189/189**، TypeScript/ESLint/build/SEO، والمتصفح **243 PASS / 51 conditional skips سابقة**، retries0. لا اختبارات مستثناة جديدة أو تغيير timeout/config.
- العزل Chromium/WebKit: external/Production requests escaped **0**؛ Gitleaks للملفات المعدلة exit **0**. فحص staged والإيداع والرفع وCI لنفس SHA هي بوابة التسليم التالية.
- migrations **001–131 دون تعديل**، بصمة 131 محفوظة ولا 132. لا Production/deploy أو Phase 7. تحديث الكمية في الواجهة ليس بديلًا عن حراسة DB الذرية للحزمة د.

- 9/10: إدارة التركيز وTab/Escape واستعادة زر الفتح، نافذة عليا واحدة فقط، واحترام الانشغال وعدم إلغاء محاولات recovery. تشمل النوافذ الداخلية الفعلية التي تتداخل مع Modal/Checkout/Cart.
- 11: أزرار فعلية للوحات مخزون Dashboard ومنتجات POS؛ نفس callbacks والقيود الحالية.
- 14/15: تسميات الحقول والأيقونات، required/error semantics وتركيز أول خطأ Checkout دون تغيير قواعد التحقق.
- تصحيح 3 المعتمد: الأصل أولًا؛ البدائل حسب تاريخ الإصدار ثم عمق السلسلة ثم sourceId. إن نقص التاريخ يعتمد العمق ثم sourceId. السلسلة المفقودة/المتناقضة تُرفض، ولا تكلفة أو تاريخ مختلق.
- لا DB/migrations أو Production/deploy أو Phase 7. إتمام الحزمة يتطلب فحصًا مركزًا، quality، Gitleaks exit 0، commit/push وCI لنفس SHA.
- الدليل المركز: allocation/continuity 9/9، Chromium/WebKit 16/16، وتصحيح عدم نقل التركيز أثناء الكتابة 2/2، بلا retries. فحص quality الأخير: Admin 684/684، المتجر 189/189، build/SEO والعزل PASS؛ المتصفح 234 PASS، 51 skip سابقة، وفشل WebKit واحد في مساعد المتجر خارج تغييرات الحزمة. إعادة السيناريو منفردًا ببيئة جديدة نجحت 1/1 بلا تعديل أو retries؛ سبب الفشل غير محسوم، وquality الكاملة لا تزال FAIL. لا commit/push للحزمة (ج) بعد.
- متابعة معتمدة: مقارنة الاختبار الأول WebKit repeat10/workers2/retries0 نجحت 10/10 على الحالي و10/10 على الأساس b3eda6f، وEscape/السلة 2/2. لا دليل كافٍ لنسب الـtimeout للحزمة أو تعديل اختبار المساعد؛ لم يتغير الكود/الاختبار أو المهلات. إعادة quality الكاملة المعتمدة **PASS**: Admin684/684، المتجر189/189، lint/build/SEO، عزل خارجي/Production escaped0، والمتصفح235 PASS و51 conditional skips سابقة، retries0. النتيجة السابقة محفوظة كتاريخ وليست الحالة النهائية.
