export const REQUIRED_SECURITY_HEADERS = Object.freeze([
  'strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options',
]);
export const PUBLIC_SERVICES = Object.freeze([
  {key: 'admin', url: 'https://admin.alnawasreh.com'},
  {key: 'customer', url: 'https://alnawasreh.com'},
]);

export async function collectPublicAvailability({services = PUBLIC_SERVICES, fetchImpl = fetch, now = new Date()} = {}) {
  const checks = [];
  for (const service of services) {
    let healthy = false;
    /** @type {{httpStatus?: number|string, missingHeaders?: string}} */
    let details = {};
    try {
      const response = await fetchImpl(service.url, {redirect: 'follow', signal: AbortSignal.timeout(15_000)});
      const missingHeaders = REQUIRED_SECURITY_HEADERS.filter(name => !response.headers.get(name)?.trim());
      healthy = response.status === 200 && missingHeaders.length === 0;
      details = {httpStatus: response.status, missingHeaders: missingHeaders.join(',') || 'none'};
      await response.body?.cancel(); // Discard content; status and headers only.
    } catch { healthy = false; details = {httpStatus: 'unreachable'}; }
    checks.push({key: `developer:uptime:${service.key}`, source: 'Public Uptime', severity: 'high', healthy,
      summary: healthy ? `${service.key} متاح مع ترويسات الحماية.` : `${service.key} غير متاح أو تنقصه ترويسات الحماية.`,
      details, observedAt: now.toISOString()});
  }
  return checks;
}
