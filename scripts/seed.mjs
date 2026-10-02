#!/usr/bin/env node
/**
 * CLI دادهٔ مرجع.
 *
 *   node scripts/seed.mjs              اجرای seed روی پایگاه‌دادهٔ توسعه
 *   node scripts/seed.mjs --memory     اجرا روی پایگاه‌دادهٔ موقت درون‌حافظه
 *   node scripts/seed.mjs --url <dsn>  اجرا روی PostgreSQL مشخص
 *   node scripts/seed.mjs --list       فهرست فایل‌های seed
 *
 * قاعده: اجرای دوباره، بی‌اثر است (§180). هر فایل، خودش ایدمپوتنت نوشته شده و
 * این اجراکننده هم درهم آن را ثبت می‌کند تا اجرای تکراری و بی‌تغییر را رد کند.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';

import { openDatabase } from './lib/engine.mjs';
import { migrate } from './lib/migrate.mjs';
import { checksumOf } from './lib/migrate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const migrationsDir = join(projectRoot, 'migrations');
const seedsDir = join(projectRoot, 'seeds');

const BOOTSTRAP = `
create schema if not exists ops;
create table if not exists ops.seed (
  filename text primary key,
  checksum text not null,
  applied_at timestamptz not null default now(),
  duration_ms integer not null
);
comment on table ops.seed is 'دفتر فایل‌های seed اجراشده؛ همان قاعدهٔ مهاجرت، برای دادهٔ مرجع';
`;

function parseArgs(argv) {
  const args = { memory: false, url: undefined, list: false, dataDir: join(projectRoot, '.data', 'pg') };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--memory') args.memory = true;
    else if (token === '--list') args.list = true;
    else if (token === '--url') args.url = argv[++i];
    else if (token === '--data-dir') args.dataDir = argv[++i];
    else throw new Error(`گزینهٔ ناشناخته: ${token}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const log = (message) => process.stdout.write(`${message}\n`);

const engine = await openDatabase({
  url: args.url ?? (args.memory ? '' : process.env.PETAVU_DATABASE_URL || ''),
  dataDir: args.memory || process.env.PETAVU_DATABASE_URL ? undefined : args.dataDir,
});

try {
  const entries = (await readdir(seedsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  if (args.list) {
    for (const filename of entries) log(filename);
    process.exit(0);
  }

  // seed روی اسکیمای ساخته‌شده اجرا می‌شود؛ اگر مهاجرت معلق باشد، اول آن.
  const migrationResult = await migrate(engine, { dir: migrationsDir, log });
  if (migrationResult.applied.length > 0) {
    log(`${migrationResult.applied.length} مهاجرت پیش از seed اجرا شد.`);
  }

  await engine.exec(BOOTSTRAP);
  const applied = new Map(
    (await engine.query('select filename, checksum from ops.seed')).map((row) => [String(row.filename), String(row.checksum)]),
  );

  let ran = 0;
  let skipped = 0;

  for (const filename of entries) {
    const sql = await readFile(join(seedsDir, filename), 'utf8');
    const checksum = checksumOf(sql);
    if (applied.get(filename) === checksum) {
      skipped += 1;
      continue;
    }

    const startedAt = Date.now();
    await engine.withTransaction(async (handle) => {
      await handle.exec(sql);
      await handle.query(
        `insert into ops.seed (filename, checksum, duration_ms) values ($1, $2, $3)
         on conflict (filename) do update set checksum = excluded.checksum, duration_ms = excluded.duration_ms, applied_at = now()`,
        [filename, checksum, Date.now() - startedAt],
      );
    });
    ran += 1;
    log(`اجرا شد ${filename} (${Date.now() - startedAt} میلی‌ثانیه)`);
  }

  log(ran === 0 ? `همهٔ ${skipped} فایل seed از قبل اجرا شده بود.` : `${ran} فایل seed اجرا شد (${skipped} از قبل).`);
} finally {
  await engine.close();
}
