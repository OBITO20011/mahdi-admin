[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$targetRef = 'kzevmysfydaslxcerogt'
if (-not $Apply) {
  [ordered]@{ok=$true;mode='Plan';projectRef=$targetRef;messages=1;claims=0;networkAccess=$false;next='OWNER_EXPLICIT_APPLY_AND_HIDDEN_INTERNAL_SECRET_REQUIRED'} | ConvertTo-Json -Compress
  exit 0
}
$hiddenSecret = $null
$secretPointer = [IntPtr]::Zero
$requestHeaders = @{}
$plainSecret = $null
try {
  if ((Read-Host 'اكتب مرجع فرانكفورت') -cne $targetRef) { throw 'OWNER_TARGET_REQUIRED' }
  if ((Read-Host 'لرسالة اختبار واحدة بلا حجز أحداث، اكتب TEST OWNER TELEGRAM') -cne 'TEST OWNER TELEGRAM') { throw 'OWNER_TEST_CONSENT_REQUIRED' }
  $hiddenSecret = Read-Host 'السر الداخلي OWNER_TELEGRAM_DISPATCH_SECRET (إدخال مخفي)' -AsSecureString
  $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($hiddenSecret)
  $plainSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  if ($plainSecret.Length -lt 32) { throw 'OWNER_INTERNAL_SECRET_REQUIRED' }
  $requestHeaders['x-owner-telegram-secret'] = $plainSecret
  $result = Invoke-RestMethod -Method Post -Uri ('https://' + $targetRef + '.supabase.co/functions/v1/owner-telegram-dispatch') -Headers $requestHeaders -ContentType 'application/json' -Body '{"mode":"test","testConsent":true}' -TimeoutSec 15
  if ($result.code -cne 'OWNER_TELEGRAM_TEST_DELIVERED' -or $result.testDelivered -ne $true) { throw 'OWNER_TEST_NOT_CONFIRMED' }
  [ordered]@{ok=$true;code='OWNER_TELEGRAM_TEST_DELIVERED';testDelivered=$true;messages=1;claims=0} | ConvertTo-Json -Compress
} catch {
  # Never output the HTTP error/response,token,recipient,header or native error.
  [ordered]@{ok=$false;code='OWNER_TELEGRAM_TEST_NOT_CONFIRMED';next='KEEP_DISABLED_CHECK_OWNER_EDGE_SETTINGS'} | ConvertTo-Json -Compress
  exit 1
} finally {
  $requestHeaders.Clear()
  $plainSecret = $null
  if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
  if ($null -ne $hiddenSecret) { $hiddenSecret.Dispose() }
}
