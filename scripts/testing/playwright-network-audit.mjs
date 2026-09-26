const guardOrigin = 'http://127.0.0.1:4175';

export async function resetBrowserNetworkAudit() {
  const response = await fetch(`${guardOrigin}/__network-guard/reset`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Browser QA network guard reset failed.');
}

export async function verifyBrowserNetworkAudit() {
  const response = await fetch(`${guardOrigin}/__network-guard/status`);
  if (!response.ok) throw new Error('Browser QA network guard status failed.');
  const result = await response.json();
  if (!Array.isArray(result.denied) || result.denied.length > 0) {
    throw new Error(
      `Browser QA attempted network access outside the isolated boundary: ${JSON.stringify(result.denied)}`,
    );
  }
}
