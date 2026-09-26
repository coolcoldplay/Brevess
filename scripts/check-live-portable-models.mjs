import { writeFile } from 'node:fs/promises';
import { loadLivePortableProfile, liveProfileMetadata } from './lib/live-portable-profile.mjs';

// Read-only connection verification using only the explicitly selected export.
const [file, name, reportFile, transport = 'node'] = process.argv.slice(2);
async function main() {
  if (!file || !name || !reportFile) throw new Error('ARGS_REQUIRED');
  if (!['node', 'curl'].includes(transport)) throw new Error('TRANSPORT_INVALID');
  const profile = await loadLivePortableProfile(file, name);
  if (profile.providerId !== 'deepseek' || (profile.baseUrl &&
      !/^https:\/\/api\.deepseek\.com\/(?:chat\/completions|responses)?$/u.test(profile.baseUrl))) {
    throw new Error('OFFICIAL_DEEPSEEK_REQUIRED');
  }
  const report = { checkedAt: new Date().toISOString(), profile: liveProfileMetadata(profile),
    endpoint: 'https://api.deepseek.com/models', networkTransport: transport, requestCount: 1, status: 'PENDING' };
  try {
    const fetchImpl = transport === 'curl'
      ? (await import('./lib/live-curl-fetch.mjs')).curlFetch : globalThis.fetch;
    const response = await fetchImpl(report.endpoint, { redirect: 'error',
      headers: { Authorization: `Bearer ${profile.apiKey}` }, signal: AbortSignal.timeout(30000) });
    report.httpStatus = response.status;
    if (!response.ok) { await response.body?.cancel(); throw new Error('HTTP_FAILED'); }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error('RESPONSE_TOO_LARGE');
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(body.data)) throw new Error('INVALID_MODEL_LIST');
    report.models = body.data.map(item => item?.id).filter(id =>
      typeof id === 'string' && /^[A-Za-z0-9_.:/-]{1,160}$/u.test(id));
    report.requestedModel = 'deepseek-flash';
    report.requestedModelAvailable = report.models.includes(report.requestedModel);
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.code = ['HTTP_FAILED', 'RESPONSE_TOO_LARGE', 'INVALID_MODEL_LIST'].includes(error?.message)
      ? error.message : /^LIVE_CURL_[A-Z_]+$/u.test(error?.code) ? error.code : 'REQUEST_FAILED';
  }
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}
main().catch(error => {
  process.stderr.write(`${/^[A-Z_]+$/u.test(error?.message) ? error.message : 'PROFILE_CHECK_FAILED'}\n`);
  process.exitCode = 1;
});
