/**
 * اجرای دادهٔ مرجع (seed).
 *
 * یک جا برای همه: CLI، تست‌ها و هر ابزار دیگری که به دادهٔ مرجع نیاز دارد.
 * چرا ماژول جدا شد: پیش‌تر تست‌ها فقط `0001_reference.sql` را می‌خواندند؛ با
 * آمدن فایل‌های تازه، تست‌ها بی‌آنکه کسی بفهمد از تولید عقب می‌افتادند. حالا
 * «seed» یعنی همان چیزی که `npm run seed` اجرا می‌کند، نه یک نسخهٔ دستی.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { checksumOf } from './migrate.mjs';

/*
 * دفتر seed، پایگاه‌دادهٔ خودش را می‌سازد.
 *
 * پس همین‌جا هم باید همان قاعدهٔ سراسری رعایت شود: RLS روشن + سیاست صریح.
 * نسخهٔ نخست این جدول را بی‌RLS می‌ساخت و تست پوشش، همان روز اول گرفتش —
 * «هیچ جدولی بی RLS» یعنی هیچ، حتی جدولی که خودِ ابزار ساخته است.
 */
const BOOTSTRAP = `
create schema if not exists ops;
create table if not exists ops.seed (
  filename text primary key,
  checksum text not null,
  applied_at timestamptz not null default now(),
  duration_ms integer not null
);
comment on table ops.seed is 'دفتر فایل‌های seed اجراشده؛ همان قاعدهٔ مهاجرت، برای دادهٔ مرجع';
alter table ops.seed enable row level security;
drop policy if exists seed_staff_read on ops.seed;
create policy seed_staff_read on ops.seed
  for select to pv_app
  using (app.has_platform_permission('platform.settings.manage'));
drop policy if exists seed_reader on ops.seed;
create policy seed_reader on ops.seed
  for select to pv_reader
  using (true);
`;

/** فهرست فایل‌های seed، به ترتیب نام. */
export async function seedFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

/**
 * اجرای فایل‌های seed.
 *
 * پیش‌فرض ایدمپوتنت است: فایلی که درهمش تغییر نکرده، دوباره اجرا نمی‌شود.
 * `force` برای آزمون «اجرای دوباره، اثر دوباره ندارد» است: همان SQL را
 * دوباره می‌فرستد و باید بی‌اثر بماند (§180).
 */
export async function applySeeds(engine, { dir, log, force = false } = {}) {
  const files = await seedFiles(dir);
  await engine.exec(BOOTSTRAP);

  const applied = new Map(
    (await engine.query('select filename, checksum from ops.seed')).map((row) => [String(row.filename), String(row.checksum)]),
  );

  const result = { applied: [], skipped: [], forced: [] };

  for (const filename of files) {
    const sql = await readFile(join(dir, filename), 'utf8');
    const checksum = checksumOf(sql);

    if (!force && applied.get(filename) === checksum) {
      result.skipped.push(filename);
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

    result.applied.push(filename);
    if (force) result.forced.push(filename);
    log?.(`اجرا شد ${filename} (${Date.now() - startedAt} میلی‌ثانیه)`);
  }

  if (log) {
    log(
      result.applied.length === 0
        ? `همهٔ ${result.skipped.length} فایل seed از قبل اجرا شده بود.`
        : `${result.applied.length} فایل seed اجرا شد (${result.skipped.length} از قبل).`,
    );
  }

  return result;
}
