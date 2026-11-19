// Owner-run browser-console probe. GET only; never run by the agent against hosted services.
void (async () => {
  const credentials = {key: '', token: ''};
  let headers;
  let completed = 0, status = null;
  const relativePath = '/rest/v1/products?select=id&limit=1';
  const fail = (code) => { throw Object.assign(new Error(code), {probeCode: code}); };
  const jwtPayload = (token) => {
    try {
      const part = token.split('.')[1];
      return JSON.parse(atob(part.replaceAll('-', '+').replaceAll('_', '/')));
    } catch { return null; }
  };
  try {
    const projectRef = 'kzevmysfydaslxcerogt';
    const origin = 'https://' + projectRef + '.supabase.co';
    credentials.key = (prompt('مفتاح anon أو publishable العام لمشروع فرانكفورت فقط — لا تدخل service_role أو secret key:') || '').trim();
    if (!credentials.key) { console.info('أُلغي القياس دون أي طلب.'); return; }
    const publicJwt = jwtPayload(credentials.key);
    if (!credentials.key.startsWith('sb_publishable_') && publicJwt?.role !== 'anon') fail('PUBLIC_KEY_REQUIRED');
    if (confirm('استخدام جلسة الدخول الحالية من هذا المتصفح إن وُجدت؟ لا تُنسخ الجلسة إلى أي مخرج.')) {
      const raw = localStorage.getItem('sb-' + projectRef + '-auth-token');
      if (raw) {
        let session;
        try { session = JSON.parse(raw); } catch { fail('SESSION_FORMAT_UNSUPPORTED'); }
        credentials.token = session?.access_token || '';
        if (!credentials.token) fail('SESSION_FORMAT_UNSUPPORTED');
        const claims = jwtPayload(credentials.token);
        if (claims?.role !== 'authenticated') fail('AUTHENTICATED_SESSION_REQUIRED');
        if (!Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) fail('SESSION_EXPIRED_NO_REFRESH');
      }
    }
    const authentication = credentials.token ? 'existing authenticated session' : 'public anon/publishable key';
    headers = {apikey: credentials.key, Accept: 'application/json'};
    if (credentials.token || publicJwt?.role === 'anon') headers.Authorization = 'Bearer ' + (credentials.token || credentials.key);
    const samples = [];
    for (let i = 0; i < 50; i++) {
      status = null;
      const started = performance.now();
      const response = await fetch(origin + relativePath, {
        method: 'GET', headers, credentials: 'omit', cache: 'no-store',
        redirect: 'error', referrerPolicy: 'no-referrer',
      });
      status = response.status;
      if (!response.ok) fail('HTTP_NOT_OK');
      const body = await response.json();
      if (!Array.isArray(body) || body.length > 1) fail('UNEXPECTED_READ_RESPONSE');
      samples.push(performance.now() - started);
      completed++;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const mean = samples.reduce((sum, n) => sum + n, 0) / samples.length;
    const percentile = (p) => sorted[Math.ceil(sorted.length * p) - 1];
    const round = (n) => Math.round(n * 100) / 100;
    console.info(JSON.stringify({
      readOnly: true, method: 'GET', path: relativePath, authentication,
      samples: completed, meanMs: round(mean), p50Ms: round(percentile(0.5)),
      p95Ms: round(percentile(0.95)), assumedImportRequests: 9438,
      estimatedImportMinutes: round(9438 * mean / 60000),
      interpretation: 'Light GET extrapolation only; excludes writer SQL, UI and workbook processing. Not a cutover duration guarantee.',
    }));
  } catch (error) {
    console.warn(JSON.stringify({
      readOnly: true, completed, method: 'GET', path: relativePath,
      code: error?.probeCode || 'NETWORK_OR_BROWSER_FAILURE',
      httpStatus: status,
      errorClass: ['TypeError', 'SyntaxError', 'AbortError', 'SecurityError'].includes(error?.name) ? error.name : 'Error',
    }));
  } finally {
    credentials.key = ''; credentials.token = '';
    if (headers) { delete headers.apikey; delete headers.Authorization; }
  }
})();
