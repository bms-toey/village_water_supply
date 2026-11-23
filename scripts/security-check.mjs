import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];
const passes = [];
const ignored = new Set(['.git', 'node_modules', '.edge-debug']);

function rel(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function walk(dir = root) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith('.edge-')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireFiles() {
  const required = [
    'README.md',
    'SECURITY.md',
    'docs/SECURITY_PDPA.md',
    'docs/iso27001/READINESS_AUDIT.md',
    'docs/iso27001/RISK_REGISTER.md',
    'docs/iso27001/STATEMENT_OF_APPLICABILITY.md',
    'docs/iso27001/OPERATING_PROCEDURES.md',
    'sql/verify_install.sql',
  ];
  const missing = required.filter(file => !fs.existsSync(path.join(root, file)));
  if (missing.length) errors.push(`Required governance/evidence files missing: ${missing.join(', ')}`);
  else passes.push('Required governance and ISO readiness evidence files are present');
}

function scanSecrets(files) {
  const patterns = [
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['OpenAI-style secret', /\bsk-[A-Za-z0-9_-]{24,}\b/],
    ['assigned service-role secret', /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"`][^'"`\s]{16,}/],
  ];
  const textFiles = files.filter(file => !/\.(?:png|jpe?g|webp|ico|woff2?|ttf|zip|pdf)$/i.test(file));
  for (const file of textFiles) {
    const relative = rel(file);
    if (relative === '.env' || relative === 'config.js' || relative.endsWith('.example')) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const [label, pattern] of patterns) {
      if (pattern.test(source)) errors.push(`${label} pattern found in ${relative}`);
    }
  }
  if (!errors.some(item => /key|secret/i.test(item))) passes.push('No prohibited high-confidence secret pattern found');
}

function checkHtml() {
  for (const file of ['index.html', 'portal.html']) {
    const html = read(file);
    const csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/i)?.[1] || '';
    for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      if (!csp.includes(directive)) errors.push(`${file}: CSP is missing ${directive}`);
    }
    if (csp.includes("script-src 'self' 'unsafe-inline'")) {
      warnings.push(`${file}: CSP still allows inline script/event handlers; remove after handler refactor`);
    }

    for (const match of html.matchAll(/<script\b[^>]*\bsrc="(https:\/\/[^"]+)"[^>]*>/gi)) {
      if (!/\bintegrity="sha384-[^"]+"/i.test(match[0])) errors.push(`${file}: remote script lacks SRI: ${match[1]}`);
    }
    for (const match of html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="(https:\/\/[^"]+)"[^>]*>/gi)) {
      if (match[1].includes('fonts.googleapis.com')) continue;
      if (!/\bintegrity="sha384-[^"]+"/i.test(match[0])) errors.push(`${file}: remote stylesheet lacks SRI: ${match[1]}`);
    }
  }
  if (!errors.some(item => item.includes('CSP') || item.includes('SRI'))) passes.push('CSP baseline and remote dependency SRI checks pass');
}

function checkImports(files) {
  const jsFiles = files.filter(file => /\.(?:js|mjs)$/i.test(file));
  for (const file of jsFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const specs = [
      ...source.matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g),
    ].map(match => match[1]);
    for (const spec of specs) {
      const target = path.resolve(path.dirname(file), spec);
      if (!fs.existsSync(target)) errors.push(`${rel(file)} imports missing file ${spec}`);
    }
  }
  if (!errors.some(item => item.includes('imports missing'))) passes.push('All relative JavaScript imports resolve');
}

function checkSql() {
  const sql = read('sql/sql_phase5_security.sql');
  const required = [
    "SET search_path = ''",
    'ENABLE ROW LEVEL SECURITY',
    'verify_audit_chain',
    'check_password_policy',
    'logout_session',
    'app_private.member_pii',
    'run_retention',
  ];
  for (const marker of required) {
    if (!sql.includes(marker)) errors.push(`sql/sql_phase5_security.sql missing control marker: ${marker}`);
  }
  const verify = read('sql/verify_install.sql');
  if (!verify.includes("anon เรียกได้แค่ฟังก์ชัน login")) errors.push('verify_install.sql does not verify anonymous RPC exposure');
  if (!errors.some(item => item.includes('sql/'))) passes.push('Database security migration and installation verification markers pass');
}

function checkLocalData() {
  const storage = read('src/services/storage.service.js');
  if (!storage.includes('CACHE_TTL_MS') || !storage.includes('CACHE_SAVED_AT_KEY')) {
    errors.push('Offline PII/finance cache has no enforced retention limit');
  } else {
    passes.push('Offline data cache has an enforced retention limit');
  }
  const auth = read('src/services/auth.service.js');
  if (!auth.includes('IDLE_TIMEOUT_MS') || !auth.includes('_lockForInactivity')) {
    errors.push('Authenticated UI has no inactivity lock');
  } else {
    passes.push('Authenticated UI has an inactivity lock');
  }
  warnings.push('Offline queue/photos remain device-resident until synchronized or discarded; require managed-device encryption');
}

function checkStructure() {
  if (fs.existsSync(path.join(root, 'js')) || fs.existsSync(path.join(root, 'css'))) {
    warnings.push('Legacy js/ and css/ trees coexist with src/ and styles/; archive after confirming no deployment dependency');
  }
  if (!fs.existsSync(path.join(root, '.github/workflows/security-check.yml'))) {
    errors.push('Security CI workflow is missing');
  } else {
    passes.push('Security CI workflow is present');
  }
}

const files = walk();
requireFiles();
scanSecrets(files);
checkHtml();
checkImports(files);
checkSql();
checkLocalData();
checkStructure();

console.log('AquaFlow security/readiness gate');
console.log('================================');
for (const item of passes) console.log(`PASS  ${item}`);
for (const item of warnings) console.warn(`WARN  ${item}`);
for (const item of errors) console.error(`FAIL  ${item}`);
console.log('--------------------------------');
console.log(`${passes.length} passed, ${warnings.length} warnings, ${errors.length} failed`);

if (errors.length) process.exitCode = 1;
