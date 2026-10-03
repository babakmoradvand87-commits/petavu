#!/usr/bin/env node
/**
 * خزش پیوند داخلی و تشخیص صفحهٔ یتیم (گام ۲۶؛ Addendum §۴۶).
 *
 *   node scripts/seo-crawl.mjs                  گزارش (بدون نوشتن)
 *   node scripts/seo-crawl.mjs --write          ثبت یافته‌ها در seo.content_opportunity
 *   node scripts/seo-crawl.mjs --url <dsn>      روی PostgreSQL مشخص
 *   node scripts/seo-crawl.mjs --data-dir <p>   روی پایگاه‌دادهٔ تعبیه‌شدهٔ توسعه
 *
 * کد خروج: ۰ سالم (یتیم‌ها هشدارند)، ۱ اگر پیوند شکسته یا نشانی ناسالم در نقشهٔ سایت
 * باشد — این‌ها «انتشار نکن» هستند، نه توصیه.
 *
 * سایت واقعی را رندر می‌کند (همان سرور وب، بی‌سوکت) و از `/sitemap.xml` شروع می‌کند، مثل
 * یک خزندهٔ واقعی. پایگاه‌داده باید مهاجرت و seed شده باشد (`npm run migrate && npm run seed`).
 */

import { openSite, parseSiteArgs } from './lib/site.mjs';
import { recordLinkFindings } from './lib/seo-opportunities.mjs';
import { crawlLinkGraph, walkSitemap } from '../apps/web/dist/linkgraph.js';

const { args, rest } = parseSiteArgs(process.argv.slice(2), { write: false });
for (const token of rest) {
  if (token === '--write') args.write = true;
  else throw new Error(`گزینهٔ ناشناخته: ${token}`);
}

const site = await openSite(args);
const publicOrigin = site.origin;

let exitCode = 0;
try {
  const render = (path) => site.render(path);

  const walk = await walkSitemap(publicOrigin, render);
  const graph = await crawlLinkGraph({ origin: publicOrigin, nodes: walk.urls, render });

  const out = (line) => process.stdout.write(`${line}\n`);
  out(`نقشهٔ سایت: ${walk.urls.length} نشانی`);
  out(`خزش: ${graph.crawled} صفحه، ${graph.edges.length} پیوند`);
  out(`یتیم: ${graph.orphans.length}${graph.orphans.length > 0 ? ' — ' + graph.orphans.slice(0, 8).join('، ') : ''}`);
  out(`پیوند شکسته: ${graph.broken.length}`);
  for (const link of graph.broken.slice(0, 10)) out(`  ${link.from} → ${link.to} (${link.status})`);
  out(`نشانیِ ناسالم در نقشهٔ سایت: ${graph.unhealthyNodes.length}`);
  for (const part of walk.failedParts) out(`  بخش ناسالم: ${part.path} (${part.status})`);
  if (walk.foreign.length > 0) out(`نشانیِ مبدأ دیگر در نقشهٔ سایت: ${walk.foreign.length}`);
  if (graph.truncated) out('هشدار: خزش به سقف ایمنی رسید.');

  if (args.write) {
    const summary = await recordLinkFindings(site.engine, graph);
    out(`ثبت: ${JSON.stringify(summary)}`);
  }

  if (graph.broken.length > 0 || graph.unhealthyNodes.length > 0 || walk.failedParts.length > 0 || walk.foreign.length > 0) exitCode = 1;
} finally {
  await site.close();
}
process.exitCode = exitCode;
