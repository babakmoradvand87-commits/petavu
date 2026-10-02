/**
 * اجراکنندهٔ مهاجرت — §49–۵۱
 *
 * منبع حقیقت، همین فایل‌های SQL در مخزن است؛ نه پنل یک سرویس میزبانی. پس
 * می‌توانیم هر لحظه محیط را از صفر بسازیم و بدانیم دقیقاً چه چیزی و به چه
 * ترتیبی اجرا شده است.
 *
 * قاعده‌هایی که این اجراکننده تحمیل می‌کند:
 *
 *   ۱. هر مهاجرت، یک بار. نام فایل، ترتیب را تعیین می‌کند (`0001_`, `0002_`, …).
 *   ۲. مهاجرت اجراشده تغییرناپذیر است. اگر محتوای فایلی که اجرا شده عوض شود،
 *      درهم آن با ثبت قبلی نمی‌خواند و اجرا با خطا متوقف می‌شود. دلیلش ساده
 *      است: وگرنه محیط توسعه و تولید بی‌سروصدا واگرا می‌شوند.
 *   ۳. هر مهاجرت در یک تراکنش. یا کامل، یا هیچ.
 *   ۴. اجرای دوباره، بی‌اثر است (§180 ایدمپوتنت).
 *
 * برای دستوراتی که در تراکنش اجرا نمی‌شوند (مثل `create index concurrently`)،
 * فایل با نشانگر `-- migrate:no-transaction` علامت می‌خورد.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export class MigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationError';
  }
}

export class MigrationDriftError extends MigrationError {
  constructor(version, expected, actual) {
    super(
      `مهاجرت ${version} پس از اجرا تغییر کرده است (درهم ثبت‌شده: ${expected.slice(0, 14)}…، درهم فعلی: ${actual.slice(0, 14)}…). ` +
        'مهاجرت اجراشده تغییرناپذیر است؛ برای تغییر، مهاجرت تازه بسازید.',
    );
    this.name = 'MigrationDriftError';
    this.version = version;
  }
}

export function checksumOf(sql) {
  // خط‌های پایان خط و فاصله‌های انتهایی، درهم را تغییر نمی‌دهند: تفاوت ناشی از
  // ویرایشگر نباید «تغییر مهاجرت» شمرده شود. بقیهٔ محتوا باید دقیقاً یکسان بماند.
  const normalized = sql.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();
  return `sha256:${createHash('sha256').update(normalized, 'utf8').digest('hex')}`;
}

/** شمارش تقریبی دستورها، فقط برای گزارش. */
export function countStatements(sql) {
  const withoutComments = sql.replace(/--[^\n]*/g, '');
  return (withoutComments.match(/;/g) ?? []).length;
}

export function parseVersion(filename) {
  const match = MIGRATION_FILE_PATTERN.exec(filename);
  if (!match) return null;
  return { version: match[1], name: match[2] };
}

const BOOTSTRAP_SQL = `
create schema if not exists ops;
create table if not exists ops.migration (
  version text primary key,
  name text not null,
  checksum text not null,
  applied_at timestamptz not null default now(),
  duration_ms integer not null,
  statement_count integer not null
);
comment on table ops.migration is 'دفتر مهاجرت‌های اجراشده؛ منبع حقیقت نسخهٔ اسکیما (§49–51)';
`;

/**
 * ساختن دفتر مهاجرت.
 *
 * خودش هم یک مهاجرت است، ولی نمی‌تواند فایل باشد — چون باید *پیش از* نخستین
 * مهاجرت وجود داشته باشد. پس با همان قاعدهٔ ایدمپوتنسی اینجا ساخته می‌شود.
 */
export async function bootstrap(engine) {
  await engine.exec(BOOTSTRAP_SQL);
}

export async function listMigrationFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name))
    .map((entry) => {
      const parsed = parseVersion(entry.name);
      return { filename: entry.name, version: parsed.version, name: parsed.name, path: join(dir, entry.name) };
    })
    .sort((a, b) => a.version.localeCompare(b.version));

  const seen = new Set();
  for (const file of files) {
    if (seen.has(file.version)) throw new MigrationError(`دو مهاجرت با شمارهٔ یکسان: ${file.version}`);
    seen.add(file.version);
  }
  return files;
}

export async function appliedMigrations(engine) {
  const rows = await engine.query(
    'select version, name, checksum, applied_at, duration_ms, statement_count from ops.migration order by version',
  );
  return new Map(rows.map((row) => [String(row.version), row]));
}

/**
 * اجرای مهاجرت‌های معلق.
 *
 * @returns `{ applied, skipped }` — `applied` فهرست مهاجرت‌های اجراشده در این
 *          فراخوانی، `skipped` شمار مهاجرت‌هایی که از قبل اجرا شده بودند.
 */
export async function migrate(engine, options = {}) {
  const dir = options.dir;
  if (!dir) throw new MigrationError('مسیر پوشهٔ مهاجرت‌ها لازم است');
  const log = options.log ?? (() => {});

  await bootstrap(engine);
  const files = await listMigrationFiles(dir);
  const applied = await appliedMigrations(engine);
  const result = { applied: [], skipped: 0 };

  for (const file of files) {
    const sql = await readFile(file.path, 'utf8');
    const checksum = checksumOf(sql);
    const previous = applied.get(file.version);

    if (previous) {
      if (String(previous.checksum) !== checksum) {
        throw new MigrationDriftError(file.version, String(previous.checksum), checksum);
      }
      result.skipped += 1;
      continue;
    }

    const noTransaction = /^\s*--\s*migrate:no-transaction\b/m.test(sql);
    const startedAt = Date.now();
    const record = async (handle) => {
      await handle.query(
        'insert into ops.migration (version, name, checksum, duration_ms, statement_count) values ($1, $2, $3, $4, $5)',
        [file.version, file.name, checksum, Date.now() - startedAt, countStatements(sql)],
      );
    };

    if (noTransaction) {
      log(`اجرای ${file.filename} بدون تراکنش`);
      await engine.exec(sql);
      await record(engine);
    } else {
      await engine.withTransaction(async (handle) => {
        await handle.exec(sql);
        await record(handle);
      });
    }

    const durationMs = Date.now() - startedAt;
    result.applied.push({ version: file.version, name: file.name, durationMs });
    log(`اجرا شد ${file.filename} (${durationMs} میلی‌ثانیه)`);
  }

  return result;
}

/** وضعیت مهاجرت‌ها: اجراشده، معلق، یا واگرا (درهم عوض‌شده). */
export async function migrationStatus(engine, options = {}) {
  const dir = options.dir;
  if (!dir) throw new MigrationError('مسیر پوشهٔ مهاجرت‌ها لازم است');

  await bootstrap(engine);
  const files = await listMigrationFiles(dir);
  const applied = await appliedMigrations(engine);
  const status = [];

  for (const file of files) {
    const sql = await readFile(file.path, 'utf8');
    const checksum = checksumOf(sql);
    const row = applied.get(file.version);
    status.push({
      version: file.version,
      name: file.name,
      state: row ? 'applied' : 'pending',
      appliedAt: row ? String(row.applied_at).slice(0, 19) : null,
      durationMs: row ? Number(row.duration_ms) : null,
      drift: row ? String(row.checksum) !== checksum : false,
    });
  }

  return status;
}
