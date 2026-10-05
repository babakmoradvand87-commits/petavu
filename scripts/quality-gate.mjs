/** دروازهٔ کیفیت گام ۳۵: شواهد مرورگر/native/SBOM/audit باید موجود و سبز باشند. */
import {readFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidence = join(root, 'quality/evidence');
const errors = [];
async function json(name) {
  try { return JSON.parse(await readFile(join(evidence, name), 'utf8')); }
  catch (e) { errors.push(`${name}: ${e.message}`); return null; }
}
const browser = await json('browser.json');
if (browser && browser.passed !== true) errors.push('browser quality failed');
const native = await json('native.json');
if (native && native.passed !== true) errors.push('native concurrency failed');
if (native && !String(native.server_version ?? '').startsWith('18')) errors.push('production PG target is 18.x, not embedded 17');
const sbom = await json('sbom.json');
if (!sbom?.components?.length) errors.push('SBOM missing');
try {
  const audit = await run('npm', ['audit', '--omit=dev', '--json'], {cwd: root, timeout: 60_000});
  const body = JSON.parse(audit.stdout || '{}');
  const vulns = body.metadata?.vulnerabilities?.total ?? 0;
  if (vulns > 0) errors.push(`npm audit --omit=dev: ${vulns} vulnerabilities`);
} catch (e) {
  if (e.stdout) {
    try {
      const body = JSON.parse(e.stdout);
      const vulns = body.metadata?.vulnerabilities?.total ?? 0;
      if (vulns > 0) errors.push(`npm audit --omit=dev: ${vulns} vulnerabilities`);
    } catch { errors.push('npm audit failed'); }
  } else errors.push('npm audit failed');
}
const report = {at: new Date().toISOString(), passed: errors.length === 0, errors, browser: Boolean(browser?.passed), native: Boolean(native?.passed), sbom_components: sbom?.components?.length ?? 0};
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
