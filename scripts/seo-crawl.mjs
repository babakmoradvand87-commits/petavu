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

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from './lib/engine.mjs';
import { createEmbeddedClient } from './lib/embedded-client.mjs';
import { recordLinkFindings } from './lib/seo-opportunities.mjs';
import { createWebServer } from '../apps/web/dist/index.js';
import { crawlLinkGraph, walkSitemap } from '../apps/web/dist/linkgraph.js';
import { loadEnv, silentLogger } from '../packages/shared/dist/index.js';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = { write: false, url: undefined, dataDir: join(projectRoot, '.data', 'pg') };
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index];
  if (token === '--write') args.write = true;
  else if (token === '--url') args.url = process.argv[++index];
  else if (token === '--data-dir') args.dataDir = process.argv[++index];
  else throw new Error(`گزینهٔ ناشناخته: ${token}`);
}

const engine = await openDatabase({
  url: args.url ?? process.env.PETAVU_DATABASE_URL ?? '',
  dataDir: args.url || process.env.PETAVU_DATABASE_URL ? undefined : args.dataDir,
});

const env = loadEnv(process.env);
const publicOrigin = env.origins.public;
const publicHost = new URL(publicOrigin).host;

let exitCode = 0;
try {
  if (engine.kind !== 'pglite') {
    throw new Error('این ابزار فعلاً فقط با موتور تعبیه‌شده کار می‌کند؛ اتصال PostgreSQL از طریق درایور برنامه (گام ۳۲: کارگر).');
  }
  const client = createEmbeddedClient(engine);
  const server = createWebServer({ client, env, logger: silentLogger(), assetsDirectory: join(projectRoot, 'apps/web/assets') });

  const render = async (path) => {
    const result = await server.render({ method: 'GET', url: path, host: publicHost });
    return { status: result.status, body: result.body, location: result.headers.location ?? null };
  };

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
    const summary = await recordLinkFindings(engine, graph);
    out(`ثبت: ${JSON.stringify(summary)}`);
  }

  if (graph.broken.length > 0 || graph.unhealthyNodes.length > 0 || walk.failedParts.length > 0 || walk.foreign.length > 0) exitCode = 1;
} finally {
  await engine.close();
}
process.exitCode = exitCode;
