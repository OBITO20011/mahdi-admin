# D−1 — تثبيت مرجع RESET219 الصالح في workdir المالك

**أوامر للمالك فقط، محلية بلا اتصال.** تُنفَّذ في D−1 بعد تحديث main المعتمد ونجاح CI، وقبل بروفة الأرشيف وRESET219. لا تنفّذها أثناء محاولة تصفير قائمة أو قبل استئنافها؛ الاستئناف يحتفظ بمرجعه ولقطته الأصليين. لم يستبدل Codex ملف المالك.

وجد فحص التسليم بعد #59 أن المرجع الموجود في workdir أقدم من مصادر الواجهة، رغم أن كلا المرجعين219/180. لا تكفي أرقام السقف ولا يُخفّف `assertReady219Reference`.

| العنصر | القيمة المثبتة من تقرير التسليم |
|---|---|
| المصدر الصالح | `C:\Users\TOP\NawasrahFrankfurt\go-live-rehearsal219-local-20261102\adapter-ready\local-reference-through219-ready.json` |
| SHA-256 المصدر والهدف بعد النسخ | `A915B64DE94BCA2FB8A2FC3942113B7A64379CC1E8746375FAE9297DB7A26333` |
| هدف workdir المالك | `C:\Users\TOP\NawasrahFrankfurt\nawasrah-fra-001-138\local-reference-through219-ready.json` |
| بصمة الهدف القديم عند التسليم، للمقارنة فقط | `56E3C5574C5ED17D7FAE156091F870864822865B16C2B0F2199A5292C33ABA6A` |
| المحتوى | 219 / 180 ملفاً / 636 دالة / 13 Realtime؛ manifest `1a6c507b6ff8b3965e1c01c71abf2280b84544498989085223abae90569fd916` |

المصدر: [تقرير تسليم #59 وتصحيح #60](C:/Users/TOP/NawasrahFrankfurt/merge59-revise60-20261103/التسليم-العربي.md) و[بصمات الأدوات والمرجع](C:/Users/TOP/NawasrahFrankfurt/merge59-revise60-20261103/reset219-identities.json). #59 دُمج إلى094a071d، و#60 إلى85c80df1؛ يوم القطع يُسجَّل **SHA الدمج النهائي الفعلي على main وCI له** وبصمات الأداة والمرجع والأرشيف، لا هذه الرؤوس التاريخية وحدها. إذا تغيّر مصدر وصول لاحقاً، يعاد تجهيز مرجع معتمد واختباره؛ لا تغيّر هذه البصمة يدوياً لتجاوز الرفض.

## 1. النسخ المحلي مع التحقق قبل/بعد

المالك يفتح PowerShell كـAdministrator من المجلد الرئيسي. توقف عند أول خطأ. يحتفظ الأمر بنسخة من الهدف السابق وبصمتها باسم جديد، ويستعمل ملفاً مؤقتاً مثبت البصمة قبل استبدال الهدف؛ لا يغيّر ربط Supabase أو بقية workdir. إن كان الهدف صحيحاً مسبقاً، يتحقق منه دون نسخة أو استبدال جديد.

```powershell
$ErrorActionPreference = 'Stop'
$referenceSource = 'C:\Users\TOP\NawasrahFrankfurt\go-live-rehearsal219-local-20261102\adapter-ready\local-reference-through219-ready.json'
$referenceTarget = 'C:\Users\TOP\NawasrahFrankfurt\nawasrah-fra-001-138\local-reference-through219-ready.json'
$referenceExpectedSha = 'A915B64DE94BCA2FB8A2FC3942113B7A64379CC1E8746375FAE9297DB7A26333'
$referenceWorkdir = Split-Path -Parent $referenceTarget
if (-not (Test-Path -LiteralPath $referenceWorkdir -PathType Container)) { throw 'RESET219_WORKDIR_MISSING_STOP' }
if (Test-Path -LiteralPath (Join-Path $referenceWorkdir 'RESET219_IN_PROGRESS.json')) { throw 'RESET219_ACTIVE_ATTEMPT_KEEP_ORIGINAL_REFERENCE' }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $referenceSource).Hash -ne $referenceExpectedSha) { throw 'SOURCE219_REFERENCE_HASH_MISMATCH' }
$referenceBeforeSha = if (Test-Path -LiteralPath $referenceTarget -PathType Leaf) { (Get-FileHash -Algorithm SHA256 -LiteralPath $referenceTarget).Hash } else { $null }
$referenceBackup = $null
if ($referenceBeforeSha -ne $referenceExpectedSha) {
  $referenceSuffix = [guid]::NewGuid().ToString('N')
  if ($referenceBeforeSha) {
    $referenceBackup = $referenceTarget + '.before-D1-' + $referenceSuffix
    Copy-Item -LiteralPath $referenceTarget -Destination $referenceBackup -ErrorAction Stop
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $referenceBackup).Hash -ne $referenceBeforeSha) { throw 'PREVIOUS219_REFERENCE_BACKUP_HASH_MISMATCH' }
  }
  $referenceIncoming = $referenceTarget + '.incoming-' + $referenceSuffix
  Copy-Item -LiteralPath $referenceSource -Destination $referenceIncoming -ErrorAction Stop
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $referenceIncoming).Hash -ne $referenceExpectedSha) { throw 'COPIED219_REFERENCE_HASH_MISMATCH' }
  Move-Item -LiteralPath $referenceIncoming -Destination $referenceTarget -Force -ErrorAction Stop
}
$referenceAfterSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $referenceTarget).Hash
if ($referenceAfterSha -ne $referenceExpectedSha) { throw 'TARGET219_REFERENCE_HASH_MISMATCH' }
[pscustomobject]@{ source=$referenceSource; target=$referenceTarget; beforeSha256=$referenceBeforeSha; afterSha256=$referenceAfterSha; previousCopy=$referenceBackup; matchesExpected=$true }
```

احفظ مخرجات المسار والبصمتين واسم النسخة السابقة في سجل D−1 بلا أسرار. أي خطأ يبقي القطع متوقفاً؛ لا حذف للنسخة السابقة أو تغيير ملف المرجع عند وجود علامة محاولة. الملفات `.incoming-*` المتبقية من فشل ليست مرجعاً مقبولاً ولا تُمرَّر لأداة RESET.

## 2. تحقق الجاهزية الحالي — قراءة ملفات محلية فقط

بعد نجاح النسخ، ومن **نفس main الموقّع**، يشغّل المالك التالي؛ لا كلمة DB ولا `--dry-run` حي هنا:

```powershell
Set-Location C:\Users\TOP\mahdi-admin
node --input-type=module -e "import {readReady219Reference} from './scripts/operations/frankfurt-reference219.mjs'; await readReady219Reference(process.cwd(), process.argv[1]); console.log('READY219_REFERENCE_LOCAL_OK');" 'C:\Users\TOP\NawasrahFrankfurt\nawasrah-fra-001-138\local-reference-through219-ready.json'
if ($LASTEXITCODE -ne 0) { throw 'RESET219_REFERENCE_NOT_READY_FOR_CURRENT_MAIN_STOP' }
```

القبول: `matchesExpected=True` و`READY219_REFERENCE_LOCAL_OK`، ثم تسجيل رأس main وبصمات الأداة والمرجع والأرشيف في §1 من [خطة القطع](GO_LIVE_CUTOVER_AR.md). الرفض يعني مصدر وصول أو دليل/مرجع غير متوافق: توقف واطلب مرجعاً معتمداً، لا إعادة تسمية مرجع قديم أو تعديل hash أو استثناء. إن تقدّم رأس الأداة بعد D−1، يعاد فحص الجاهزية والتوقيع وفق الخطة.

بعدها بروفة D−1، ويوم القطع **إعادة البروفة على النسخة الفاصلة نفسها أثناء تجميد الكتابات** وفق §2.2أ. النسخ أعلاه لا يشغّل RESET أو ترقية أو Backup أو نشر، ولا يغيّر مراجع 217 أو لقطات استئناف قديمة.
