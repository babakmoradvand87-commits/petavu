#!/usr/bin/env node
/**
 * وضعیت زندهٔ پروژه — «بروزرسانی کن» باید یک دستور باشد، نه یک کار دستی.
 *
 * چرا: هر عددی که در مستندات نوشته می‌شود، اگر دستی نگه داشته شود، دیر یا زود
 * از واقعیت جدا می‌شود (§103: UI و مستند، منبع حقیقت نیستند — منبع حقیقت
 * پایگاه‌داده و کد است). این ابزار پایگاه‌داده را از صفر می‌سازد، مهاجرت‌ها و
 * seed را اجرا می‌کند، و آنچه را واقعاً هست می‌شمارد و می‌نویسد.
 *
 * استفاده:
 *   node scripts/status.mjs            # چاپ روی خروجی استاندارد
 *   node scripts/status.mjs --write    # نوشتن در docs/reports/status.md
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './lib/engine.mjs';
import { migrate } from './lib/migrate.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');

/** شمارش‌هایی که واقعاً از پایگاه‌داده خوانده می‌شوند، نه از حافظهٔ نویسنده. */
const COUNTS = [
  ['جدول‌ها', `select count(*)::int as c from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where c.relkind = 'r' and n.nspname in ('ref', 'auth', 'app', 'media', 'design', 'seo', 'ops')`],
  ['توابع دامنه', `select count(*)::int as c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname in ('app', 'auth', 'media', 'design', 'seo', 'ops', 'ref')`],
  ['سیاست RLS', `select count(*)::int as c from pg_policies
                   where schemaname in ('ref', 'auth', 'app', 'media', 'design', 'seo', 'ops')`],
  ['قید یکپارچگی', `select count(*)::int as c from pg_constraint c join pg_namespace n on n.oid = c.connamespace
                      where n.nspname in ('ref', 'auth', 'app', 'media', 'design', 'seo', 'ops') and c.contype = 'c'`],
  ['ماشه', `select count(*)::int as c from pg_trigger t join pg_class cl on cl.oid = t.tgrelid
             join pg_namespace n on n.oid = cl.relnamespace
             where not t.tgisinternal and n.nspname in ('ref', 'auth', 'app', 'media', 'design', 'seo', 'ops')`],
  ['مجوز', 'select count(*)::int as c from auth.permission'],
  ['نقش کسب‌وکار', 'select count(*)::int as c from app.role where business_id is null'],
  ['نقش پلتفرم', 'select count(*)::int as c from auth.platform_role'],
  ['نوع کسب‌وکار', 'select count(*)::int as c from ref.business_type'],
  ['صنعت', 'select count(*)::int as c from ref.industry'],
  ['مکان', 'select count(*)::int as c from ref.location'],
  ['دستهٔ محتوا', 'select count(*)::int as c from ref.category'],
  ['کامپوننت طراحی', 'select count(*)::int as c from design.component'],
  ['قالب صفحه', 'select count(*)::int as c from design.page_template'],
  ['قالب سئو', 'select count(*)::int as c from seo.template'],
  ['موجودیت سئو', 'select count(*)::int as c from seo.entity'],
  ['فیچر ثبت‌شده', 'select count(*)::int as c from ops.feature'],
];

/** فهرست فایل‌های مهاجرت و seed، به ترتیب. */
async function listFiles(dir, extension = '.sql') {
  const entries = await readdir(join(projectRoot, dir));
  return entries.filter((name) => name.endsWith(extension)).sort();
}

/**
 * شمارش تست‌ها، بدون اجرای آن‌ها.
 *
 * عدد «سبز» را اینجا نمی‌سازیم: تنها مرجع، خروجی `npm test` است. اینجا فقط
 * شمار پروندهٔ تست و تعداد `test(` گزارش می‌شود تا بدانیم چند تست داریم.
 */
async function testInventory() {
  const files = (await readdir(join(projectRoot, 'tests'))).filter((name) => name.endsWith('.test.mjs')).sort();
  const rows = [];
  for (const file of files) {
    const source = await readFile(join(projectRoot, 'tests', file), 'utf8');
    const cases = source.match(/^\s*test\(/gm)?.length ?? 0;
    rows.push({ file, cases });
  }
  return rows;
}

const engine = await openDatabase();
const migrations = await migrate(engine, { dir: join(projectRoot, 'migrations') });

for (const file of await listFiles('seeds')) {
  await engine.exec(await readFile(join(projectRoot, 'seeds', file), 'utf8'));
}

const counts = [];
for (const [label, sql] of COUNTS) {
  const [row] = await engine.query(sql);
  counts.push([label, Number(row.c)]);
}

const tests = await testInventory();
await engine.close();

const testTotal = tests.reduce((sum, row) => sum + row.cases, 0);
const migrationFiles = await listFiles('migrations');
const seedFiles = await listFiles('seeds');
const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');

const lines = [];
lines.push('# وضعیت زندهٔ PETAVU');
lines.push('');
lines.push('این پرونده با `npm run status -- --write` ساخته می‌شود؛ دستی ویرایش نشود.');
lines.push('عددها از پایگاه‌داده‌ای خوانده می‌شوند که همین حالا از صفر ساخته، مهاجرت و seed شده است.');
lines.push('');
lines.push(`- **زمان اندازه‌گیری (UTC):** ${generatedAt}`);
lines.push(`- **مهاجرت‌ها:** ${migrationFiles.length} فایل، ${migrations.applied.length} اجراشده روی پایگاه‌دادهٔ تازه`);
lines.push(`- **Seed:** ${seedFiles.length} فایل — ${seedFiles.join(', ')}`);
lines.push(`- **تست‌ها:** ${testTotal} مورد در ${tests.length} پرونده (وضعیت سبز/سرخ تنها با «npm test» تأیید می‌شود)`);
lines.push('');
lines.push('## شمارش‌های پایگاه‌داده');
lines.push('');
lines.push('| سنجه | شمار |');
lines.push('| --- | --- |');
for (const [label, value] of counts) lines.push(`| ${label} | ${value.toLocaleString('fa-IR')} |`);
lines.push('');
lines.push('## تست‌ها به تفکیک پرونده');
lines.push('');
lines.push('| پرونده | تعداد تست |');
lines.push('| --- | --- |');
for (const row of tests) lines.push(`| \`tests/${row.file}\` | ${row.cases} |`);
lines.push('');
const report = lines.join('\n');

if (write) {
  await mkdir(join(projectRoot, 'docs', 'reports'), { recursive: true });
  await writeFile(join(projectRoot, 'docs', 'reports', 'status.md'), report, 'utf8');
  console.log('نوشته شد: docs/reports/status.md');
} else {
  console.log(report);
}
