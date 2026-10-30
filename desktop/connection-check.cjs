// Explicit native CLI diagnostic. Never returns identity labels or credentials.
async function checkChatgptConnection(service, version) {
  const report = { kind: 'chatgpt-connection-check', version, ok: false };
  try {
    const status = await service.status();
    report.protectedStorage = !!status.available;
    report.accountCount = status.accounts.length;
    if (!status.available) return { ...report, code: 'storage_unavailable' };
    const active = status.accounts.find((account) => account.id === status.activeId);
    if (!active?.loggedIn) return { ...report, code: 'signin_required' };
    if (!active.planEnabled) return { ...report, code: 'consent_required' };
    report.modelCount = (await service.models()).length;
    return {
      ...report,
      ok: report.modelCount > 0,
      ...(report.modelCount ? {} : { code: 'models_empty' }),
    };
  } catch (error) {
    const safe = new Set([
      'storage_unavailable',
      'signin_required',
      'consent_required',
      'account_missing',
      'account_changed',
      'account_busy',
      'identity_mismatch',
      'discovery_invalid',
      'http_401',
      'http_403',
      'http_429',
    ]);
    return { ...report, code: safe.has(error?.code) ? error.code : 'connection_failed' };
  }
}
module.exports = { checkChatgptConnection };
