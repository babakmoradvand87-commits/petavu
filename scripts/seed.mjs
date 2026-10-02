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

import { openDatabase } from './lib/engine.mjs';
import { migrate } from './lib/migrate.mjs';
import { applySeeds, seedFiles } from './lib/seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const migrationsDir = join(projectRoot, 'migrations');
const seedsDir = join(projectRoot, 'seeds');

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
  if (args.list) {
    for (const filename of await seedFiles(seedsDir)) log(filename);
    process.exit(0);
  }

  // seed روی اسکیمای ساخته‌شده اجرا می‌شود؛ اگر مهاجرت معلق باشد، اول آن.
  const migrationResult = await migrate(engine, { dir: migrationsDir, log });
  if (migrationResult.applied.length > 0) {
    log(`${migrationResult.applied.length} مهاجرت پیش از seed اجرا شد.`);
  }

  await applySeeds(engine, { dir: seedsDir, log });
} finally {
  await engine.close();
}
