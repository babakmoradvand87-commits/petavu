#!/usr/bin/env node
/**
 * دروازهٔ بودجهٔ عملکرد، سمت سرور (گام ۲۷؛ Addendum §۱–۶، §۹۶، §۹۸).
 *
 *   node scripts/perf-budget.mjs                  گزارش
 *   node scripts/perf-budget.mjs --per-pattern 3  تعداد نمونه به‌ازای هر الگوی مسیر (پیش‌فرض ۲)
 *   node scripts/perf-budget.mjs --json           خروجی ماشینی
 *   node scripts/perf-budget.mjs --url <dsn> | --data-dir <p>
 *
 * از `/sitemap.xml` نشانی‌ها را برمی‌دارد (مثل خزندهٔ واقعی)، آن‌ها را بر اساس **الگوی بودجه**
 * گروه می‌کند (`ops.budget_for_route`) و از هر گروه چند نمونه را اندازه می‌گیرد: HTML، CSS،
 * JavaScript، فونت و تصویرِ نخستین‌نما، به بایتِ سروشده. هر اندازه‌گیری با `ops.check_budget`
 * سنجیده می‌شود.
 *
 * کد خروج: ۰ همه قبول؛ ۱ اگر هر صفحه‌ای تخطی دارد (`fail`)، مسیری بی‌بودجه است (`unbudgeted`)،
 * یا منبعی ۴xx/۵xx داده است. این‌ها «انتشار نکن» هستند.
 *
 * سنجه‌هایی که بدون مرورگر ممکن نیستند (LCP، INP، CLS) در `not_compared` می‌آیند، نه با
 * عدد ساختگی: «قبول» اینجا یعنی «در سنجه‌های سروشده تخطی نیست».
 */

import { openSite, parseSiteArgs } from './lib/site.mjs';
import { walkSitemap } from '../apps/web/dist/linkgraph.js';
import { measurePage } from '../apps/web/dist/measure.js';

const { args, rest } = parseSiteArgs(process.argv.slice(2), { perPattern: 2, json: false });
for (let index = 0; index < rest.length; index += 1) {
  const token = rest[index];
  if (token === '--json') args.json = true;
  else if (token === '--per-pattern') args.perPattern = Math.max(1, Number(rest[++index]) || 2);
  else throw new Error(`گزینهٔ ناشناخته: ${token}`);
}

/** مسیرهایی که در نقشهٔ سایت نمی‌آیند ولی صفحهٔ واقعی‌اند و بودجه می‌خواهند. */
const EXTRA_PATHS = ['/search', '/search?q=%DA%A9%D9%84%DB%8C%D9%86%DB%8C%DA%A9'];

const site = await openSite(args);
let exitCode = 0;
try {
  const walk = await walkSitemap(site.origin, (path) => site.render(path));
  const candidates = [...new Set([...walk.urls, ...EXTRA_PATHS])];

  // گروه‌بندی بر اساس الگوی بودجه؛ مسیرِ بی‌الگو، گروه خودش را دارد.
  const groups = new Map();
  for (const path of candidates) {
    const [row] = await site.engine.query(`select route_pattern from ops.budget_for_route($1)`, [path.split('?')[0]]);
    const pattern = row?.route_pattern ?? `~unbudgeted:${path.split('?')[0]}`;
    const list = groups.get(pattern) ?? [];
    list.push(path);
    groups.set(pattern, list);
  }

  const rows = [];
  for (const [pattern, paths] of groups) {
    // نمونه‌ها: اولی، آخری و میانی؛ تا حد `perPattern`.
    const picks = [...new Set([paths[0], paths.at(-1), paths[Math.floor(paths.length / 2)]])].slice(0, args.perPattern);
    for (const path of picks) {
      const report = await measurePage({ path, origin: site.origin, fetch: (resource) => site.fetchResource(resource) });
      const [{ check }] = await site.engine.query(`select ops.check_budget($1, $2::jsonb) as check`, [path.split('?')[0], JSON.stringify(report.measurement)]);
      rows.push({ pattern, path, report, check });
    }
  }

  const bad = rows.filter((row) => row.check.verdict !== 'pass' || row.report.failed.length > 0);
  if (bad.length > 0) exitCode = 1;

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ rows: rows.map((row) => ({ pattern: row.pattern, path: row.path, ...row.report.measurement, verdict: row.check.verdict, breaches: row.check.breaches, not_compared: row.check.not_compared, failed: row.report.failed })) }, null, 2)}\n`);
  } else {
    const out = (line) => process.stdout.write(`${line}\n`);
    out(`نشانی‌های نمونه: ${rows.length} صفحه در ${groups.size} الگوی بودجه`);
    out('الگو'.padEnd(16) + 'مسیر'.padEnd(34) + 'HTML'.padStart(7) + 'CSS'.padStart(7) + 'JS'.padStart(7) + 'فونت'.padStart(7) + 'تصویر'.padStart(8) + 'کل'.padStart(8) + 'درخواست'.padStart(9) + '  رأی');
    for (const row of rows) {
      const m = row.report.measurement;
      out(
        String(row.pattern).padEnd(16) + decodeURIComponent(row.path).slice(0, 32).padEnd(34) +
          String(m.html_kb).padStart(7) + String(m.css_kb).padStart(7) + String(m.js_kb).padStart(7) + String(m.font_kb).padStart(7) +
          String(m.image_kb).padStart(8) + String(m.weight_kb).padStart(8) + String(m.request_count).padStart(9) + `  ${row.check.verdict}`,
      );
      for (const breach of row.check.breaches) out(`    ✗ ${breach.metric}: ${breach.actual} > ${breach.budget}`);
      for (const resource of row.report.failed) out(`    ✗ منبع ناسالم: ${resource.path} (${resource.status})`);
    }
    out(`رأی کلی: ${bad.length === 0 ? 'قبول' : `رد (${bad.length} صفحه)`}`);
  }
} finally {
  await site.close();
}
process.exitCode = exitCode;
