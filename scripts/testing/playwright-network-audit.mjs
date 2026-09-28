const guardOrigin = 'http://127.0.0.1:4175';

export async function resetBrowserNetworkAudit() {
  const response = await fetch(`${guardOrigin}/__network-guard/reset`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Browser QA network guard reset failed.');
  await registerExpectedBlockedCanary('CONNECT', 'test.invalid:443');
}

export async function registerExpectedBlockedCanary(method, target) {
  const response = await fetch(`${guardOrigin}/__network-guard/expect-blocked-canary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, target }),
  });
  if (!response.ok) throw new Error('Browser QA blocked-canary registration failed.');
}

export async function verifyBrowserNetworkAudit() {
  const response = await fetch(`${guardOrigin}/__network-guard/status`);
  if (!response.ok) throw new Error('Browser QA network guard status failed.');
  const result = await response.json();
  if (
    !Array.isArray(result.blockedCanaryAttempts) ||
    !Array.isArray(result.deniedUnexpectedAttempts) ||
    !Array.isArray(result.escapedExternalRequests)
  ) {
    throw new Error('Browser QA network guard returned an invalid audit result.');
  }
  if (
    result.deniedUnexpectedAttempts.length > 0 ||
    result.escapedExternalRequests.length > 0
  ) {
    throw new Error(
      `Browser QA network isolation failed: ${JSON.stringify({
        deniedUnexpectedAttempts: result.deniedUnexpectedAttempts,
        escapedExternalRequests: result.escapedExternalRequests,
      })}`,
    );
  }
}
