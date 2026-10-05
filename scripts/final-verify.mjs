/** گام ۴۰: نصب تازه migrate+seed+backup+restore. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(join(tmpdir(), 'petavu-final-'));
const env = {
  ...process.env,
  PETAVU_ENV: 'test',
  PETAVU_DATA_DIR: dir,
  AUTH_PEPPER: 'final-verify-pepper-value-32ch',
  BACKUP_KEY: 'final-verify-pepper-value-32ch',
  SESSION_SECRET: 'final-verify-session-secret-32ch',
  BACKUP_DIR: join(dir, 'backups'),
};
try {
  const backup = JSON.parse((await run(process.execPath, ['scripts/backup.mjs', '--bootstrap'], {cwd: root, env, timeout: 180000})).stdout);
  const restore = JSON.parse((await run(process.execPath, ['scripts/restore.mjs', '--id', backup.id], {cwd: root, env, timeout: 180000})).stdout);
  const report = {at: new Date().toISOString(), backup, restore, passed: restore.status === 'succeeded'};
  await mkdir(join(root, 'docs/reports'), {recursive: true});
  await writeFile(join(root, 'docs/reports/final.md'), `# تأیید نهایی\n\n${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  await rm(dir, {recursive: true, force: true});
}
