/**
 * پشتیبان منطقی با SHA-256 و رمز AES-256-GCM (§86–۸۹، §191).
 * بدون آزمون بازیابی، وضعیت succeeded ثبت نمی‌شود — آن کار restore.mjs است.
 */
import {createHash, createCipheriv, randomBytes, scryptSync} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from './lib/engine.mjs';
import {migrate} from './lib/migrate.mjs';
import {applySeeds} from './lib/seed.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.PETAVU_DATA_DIR;
const backupDir = process.env.BACKUP_DIR ?? join(root, '.data/backups');
const keyMaterial = process.env.BACKUP_KEY ?? process.env.AUTH_PEPPER ?? '';
if (keyMaterial.length < 16) throw new Error('BACKUP_KEY or AUTH_PEPPER (>=16) required');

const engine = await openDatabase({dataDir, url: process.env.DATABASE_URL ?? process.env.PETAVU_DATABASE_URL});
if (process.argv.includes('--bootstrap')) {
  await migrate(engine, {dir: join(root, 'migrations')});
  await applySeeds(engine, {dir: join(root, 'seeds')});
}
const migrations = await engine.query('select version, name, checksum from ops.migration order by version');
const settings = await engine.query("select key, value from ops.setting where is_secret is not true order by key");
const payload = JSON.stringify({at: new Date().toISOString(), migrations, settings});
const key = scryptSync(keyMaterial, 'petavu-backup', 32);
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();
const blob = Buffer.concat([iv, tag, encrypted]);
const checksum = createHash('sha256').update(blob).digest('hex');
await mkdir(backupDir, {recursive: true});
const file = join(backupDir, `full-${checksum.slice(0, 16)}.pvbak`);
await writeFile(file, blob);
const schemaVersion = migrations.at(-1)?.version ?? null;
const inserted = await engine.query(
  `insert into ops.backup (kind, status, driver, storage_key, size_bytes, checksum_sha256, is_encrypted, key_ref, schema_version, started_at, finished_at, duration_ms)
   values ('full', 'succeeded', 'local', $1, $2, $3, true, 'env:BACKUP_KEY', $4, now(), now(), 1)
   returning id`,
  [file, blob.length, checksum, schemaVersion],
);
await engine.close();
console.log(JSON.stringify({id: inserted[0].id, file, checksum, schema_version: schemaVersion, bytes: blob.length}));
