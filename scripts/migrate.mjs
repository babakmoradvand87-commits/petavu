#!/usr/bin/env node
/**
 * CLI مهاجرت.
 *
 *   node scripts/migrate.mjs                 اجرای مهاجرت‌های معلق روی پایگاه‌دادهٔ توسعه
 *   node scripts/migrate.mjs --status        نمایش وضعیت
 *   node scripts/migrate.mjs --url <dsn>     اجرا روی PostgreSQL مشخص
 *   node scripts/migrate.mjs --memory        اجرا روی پایگاه‌دادهٔ موقت درون‌حافظه
 *
 * پایگاه‌دادهٔ پیش‌فرض توسعه، موتور تعبیه‌شده با ذخیره در `.data/pg` است، چون
 * سرور PostgreSQL در محیط توسعه لازم نیست (§48). برای تولید، `DATABASE_URL`
 * می‌آید و همان مهاجرت‌ها بدون تغییر روی PostgreSQL اجرا می‌شوند.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { openDatabase } from './lib/engine.mjs';
import { migrate, migrationStatus } from './lib/migrate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const migrationsDir = join(projectRoot, 'migrations');

function parseArgs(argv) {
  const args = { status: false, memory: false, url: undefined, dataDir: join(projectRoot, '.data', 'pg') };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--status') args.status = true;
    else if (token === '--memory') args.memory = true;
    else if (token === '--url') args.url = argv[++i];
    else if (token === '--data-dir') args.dataDir = argv[++i];
    else throw new Error(`گزینهٔ ناشناخته: ${token}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const engine = await openDatabase({
  url: args.url ?? (args.memory ? '' : process.env.PETAVU_DATABASE_URL || ''),
  dataDir: args.memory || process.env.PETAVU_DATABASE_URL ? undefined : args.dataDir,
});

const log = (message) => process.stdout.write(`${message}\n`);

try {
  if (args.status) {
    const rows = await migrationStatus(engine, { dir: migrationsDir });
    log(`موتور: ${engine.capabilities.engine}`);
    for (const row of rows) {
      const mark = row.state === 'applied' ? (row.drift ? 'واگرا' : 'اجراشده') : 'معلق';
      log(`  ${row.version} ${row.name.padEnd(28)} ${mark}${row.durationMs === null ? '' : ` (${row.durationMs}ms)`}`);
    }
    const pending = rows.filter((row) => row.state === 'pending').length;
    const drifted = rows.filter((row) => row.drift).length;
    log(`جمع: ${rows.length} مهاجرت، ${pending} معلق، ${drifted} واگرا`);
    if (drifted > 0) process.exitCode = 2;
  } else {
    const result = await migrate(engine, { dir: migrationsDir, log });
    if (result.applied.length === 0) {
      log(`همهٔ ${result.skipped} مهاجرت از قبل اجرا شده بود؛ تغییری لازم نبود.`);
    } else {
      log(`${result.applied.length} مهاجرت اجرا شد (${result.skipped} از قبل اجرا شده بود).`);
    }
  }
} finally {
  await engine.close();
}
