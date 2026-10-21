# أمر المالك بعد قبول الحزمة7

الأمر الحالي لهذه الحزمة هو `frankfurt-owner-upgrade207`، ويشمل جميع الترقيات المعتمدة الناقصة حتى207. إذا شُغّل206 سابقاً فسيطبّق207 وحده؛ وإذا شُغّل203 سابقاً فسيطبّق204–207. لا يعيد تطبيق ما سُجّل بنجاح، ويرفض تاريخاً ناقصاً أو غير معتمد.

```powershell
Set-Location C:\Users\TOP\mahdi-admin
node scripts/operations/frankfurt-owner-upgrade207.mjs --dry-run
```

الفحص السابق يقرأ الملفات المحلية المحفوظة فقط. المالك وحده يشغّل صباحاً:

```powershell
node scripts/operations/frankfurt-owner-upgrade207.mjs --apply
node scripts/operations/frankfurt-owner-upgrade207.mjs --verify-only
```

لم ينفذ الوكيل `--apply` أو `--verify-only` ولم يتصل بفرانكفورت. أثبتت البروفات المحلية المسار نفسه والترقية التدريجية وإعادة التشغيل دون كتابة إضافية. مرجع207 الجديد منفصل؛ مراجع203–206 وأوامرها باقية لنطاقها الأصلي وبالبصمات السابقة.
