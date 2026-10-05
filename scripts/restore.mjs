/**
 * آزمون بازیابی اجباری روی محیط تازه (§191، §187).
 * پشتیبان بدون این اسکریپت «ادعا» است.
 */
import {createHash, createDecipheriv, scryptSync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {openDatabase} from './lib/engine.mjs';
import {migrate} from './lib/migrate.mjs';
import {applySeeds} from './lib/seed.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keyMaterial = process.env.BACKUP_KEY ?? process.env.AUTH_PEPPER ?? '';
if (keyMaterial.length < 16) throw new Error('BACKUP_KEY or AUTH_PEPPER required');
const backupId = process.argv.find((a, i, arr) => arr[i - 1] === '--id');
const sourceEngine = await openDatabase({
  dataDir: process.env.PETAVU_DATA_DIR,
  url: process.env.DATABASE_URL ?? process.env.PETAVU_DATABASE_URL,
});
const rows = backupId
  ? await sourceEngine.query('select * from ops.backup where id=$1', [backupId])
  : await sourceEngine.query(`select * from ops.backup where status='succeeded' order by finished_at desc limit 1`);
if (!rows.length) throw new Error('no backup');
const backup = rows[0];
const blob = await readFile(backup.storage_key);
const checksum = createHash('sha256').update(blob).digest('hex');
if (checksum !== backup.checksum_sha256) throw new Error('checksum mismatch');
const key = scryptSync(keyMaterial, 'petavu-backup', 32);
const iv = blob.subarray(0, 12);
const tag = blob.subarray(12, 28);
const data = blob.subarray(28);
const decipher = createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);
const payload = JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
const freshDir = await mkdtemp(join(tmpdir(), 'petavu-restore-'));
const checks = {passed: 0, failed: 0, notes: []};
try {
  const fresh = await openDatabase({dataDir: freshDir});
  const mig = await migrate(fresh, {dir: join(root, 'migrations')});
  const seed = await applySeeds(fresh, {dir: join(root, 'seeds')});
  const restoredMig = await fresh.query('select version, checksum from ops.migration order by version');
  const same = JSON.stringify(restoredMig.map((m) => m.version)) === JSON.stringify(payload.migrations.map((m) => m.version));
  if (same) checks.passed += 1; else { checks.failed += 1; checks.notes.push('migration list mismatch'); }
  const settingCount = (await fresh.query('select count(*)::int n from ops.setting'))[0].n;
  if (settingCount >= payload.settings.length) checks.passed += 1; else { checks.failed += 1; checks.notes.push('settings missing'); }
  await fresh.close();
  const status = checks.failed === 0 ? 'succeeded' : 'failed';
  await sourceEngine.query(
    `insert into ops.restore_test (backup_id, environment, status, started_at, finished_at, duration_ms, migrations_applied, seed_applied, checks_passed, checks_failed, report)
     values ($1,'fresh',$2,now(),now(),1,$3,$4,$5,$6,$7::jsonb)`,
    [backup.id, status, Array.isArray(mig?.applied) ? mig.applied.length : payload.migrations.length, Array.isArray(seed?.applied) ? seed.applied.length : 0, checks.passed, checks.failed, JSON.stringify({checksum, notes: checks.notes})],
  );
  console.log(JSON.stringify({backup_id: backup.id, status, checks}));
  if (status !== 'succeeded') process.exitCode = 1;
} finally {
  await rm(freshDir, {recursive: true, force: true});
  await sourceEngine.close();
}
