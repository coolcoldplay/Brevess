// Build-time only. Never copy this auditor or its synthetic test inputs into the extension.
// Findings contain file names and rule IDs, never the possibly sensitive matched value.
const developmentPath = /(?:^|\/)(?:tests?|__tests__|fixtures?|__fixtures__|testdata|test-results|playwright-report|coverage|outputs?|tmp|qa-artifacts|browser-profile|screenshots|recordings|logs|\.git|\.codex|\.idea|\.vscode|node_modules|__MACOSX)(?:\/|$)|(?:^|\/)(?:\.DS_Store|Thumbs\.db|\.env(?:\..*)?|auth\.json|credentials\.json|cookies(?:\.json|\.txt)?|Login Data|Local State)$|\.(?:test|spec)\.[cm]?js$|\.(?:log|har|map|pem|key|sqlite|sqlite3|db|bak)$/i;
const contentRules = [
  ['LOCAL_USER_PATH', /(?:^|[\s\x00"'`=(:])(?:\/(?:Users|home)\/[^/\s"'`<>]+\/|\/var\/folders\/|[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}[^\\/\s"'`<>]+[\\/])/m],
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['PROVIDER_OR_ACCESS_TOKEN', /\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{25,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,})/],
  ['JWT_CREDENTIAL', /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\b/],
  ['SYNTHETIC_TEST_RESIDUE', /\bSYNTHETIC_[A-Z0-9_]+|https?:\/\/(?:[^/\s"']+\.)?(?:fixture\.invalid|qa\.test|example\.test)(?:[/:\s"']|$)|测试专用密钥|验收专用数据/]
];
// Existing public product support contact; this is not a developer-machine account.
// New contact addresses require an explicit review instead of silently shipping them.
const publicContacts = new Set(['brevess0729@163.com']);

export function auditReleaseFile(name, bytes) {
  const findings = [];
  if (developmentPath.test(name)) findings.push({ path: name, rule: 'NON_RUNTIME_OR_PRIVATE_FILE' });
  // Include binary/string tables too: paths and credentials can also leak through assets.
  const source = Buffer.from(bytes).toString('utf8');
  for (const [rule, pattern] of contentRules) {
    if (pattern.test(source)) findings.push({ path: name, rule });
  }
  // Keep the developer's personal PubMed recoloring example out of shipped filters and prompts.
  if (/(?:^|\/)web-filters-general\//.test(name)) {
    const pubmedBlue = /#20558a\b|\b32\s*,\s*85\s*,\s*138\b/i;
    const testPink = /#ffc0cb\b|\b255\s*,\s*192\s*,\s*203\b|\bpink\b|粉[红色]/i;
    if (testPink.test(source) && (pubmedBlue.test(source) || /PubMed[^\n]{0,90}(?:变粉|改成粉|to pink)/i.test(source))) {
      findings.push({ path: name, rule: 'PERSONAL_DISPLAY_EXAMPLE' });
    }
  }
  const legalAttribution = /^(?:vendor\/|licenses\/|LICENSE$|THIRD_PARTY_NOTICES\.md$)/.test(name);
  if (!legalAttribution && [...source.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)]
    .some(match => !publicContacts.has(match[0].toLowerCase()))) {
    findings.push({ path: name, rule: 'UNREVIEWED_EMAIL_ADDRESS' });
  }
  return findings;
}

export function auditReleaseHygiene(files) {
  return [...files].flatMap(([name, bytes]) => auditReleaseFile(name, bytes));
}
