import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const run = promisify(execFile);
const root = join(import.meta.dirname, '..');
let dir, env;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'petavu-bak-'));
  env = {
    ...process.env,
    PETAVU_ENV: 'test',
    PETAVU_DATA_DIR: dir,
    AUTH_PEPPER: 'test-pepper-value-backup-key',
    BACKUP_KEY: 'test-pepper-value-backup-key',
    BACKUP_DIR: join(dir, 'dumps'),
    SESSION_SECRET: 'test-session-secret-value-0123456789',
  };
}, {timeout: 120000});

after(async () => {
  await rm(dir, {recursive: true, force: true});
});

test('backup encrypts payload, checksums, and restore-test succeeds on fresh engine', async () => {
  const backup = await run(process.execPath, ['scripts/backup.mjs', '--bootstrap'], {cwd: root, env, timeout: 180000});
  const meta = JSON.parse(backup.stdout);
  assert.equal(meta.checksum.length, 64);
  assert.ok(meta.file.endsWith('.pvbak'));
  const restore = await run(process.execPath, ['scripts/restore.mjs', '--id', meta.id], {cwd: root, env, timeout: 180000});
  const report = JSON.parse(restore.stdout);
  assert.equal(report.status, 'succeeded');
  assert.equal(report.backup_id, meta.id);
  assert.equal(report.checks.failed, 0);
}, {timeout: 240000});
