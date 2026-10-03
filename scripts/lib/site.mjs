/**
 * بازکردن سایت برای ابزارهای خط فرمان (خزش پیوند، بودجهٔ عملکرد).
 *
 * سرور وب واقعی، بی‌سوکت: همان رندر، همان پایگاه‌داده، همان پاسخ‌هایی که مرورگر می‌گیرد.
 * فقط موتور تعبیه‌شده (پایگاه‌دادهٔ توسعه)؛ اتصال PostgreSQL از راه درایور برنامه است
 * (گام ۳۲: کارگر) و این ابزارها آن را جعل نمی‌کنند.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from './engine.mjs';
import { createEmbeddedClient } from './embedded-client.mjs';
import { createWebServer } from '../../apps/web/dist/index.js';
import { loadEnv, silentLogger } from '../../packages/shared/dist/index.js';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** گزینه‌های مشترک خط فرمان: `--url`، `--data-dir`. بقیه را فراخواننده می‌خواند. */
export function parseSiteArgs(argv, extra = {}) {
  const args = { url: undefined, dataDir: join(projectRoot, '.data', 'pg'), ...extra };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--url') args.url = argv[++index];
    else if (token === '--data-dir') args.dataDir = argv[++index];
    else rest.push(token);
  }
  return { args, rest };
}

export async function openSite({ url, dataDir }) {
  const engine = await openDatabase({
    url: url ?? process.env.PETAVU_DATABASE_URL ?? '',
    dataDir: url || process.env.PETAVU_DATABASE_URL ? undefined : dataDir,
  });
  if (engine.kind !== 'pglite') {
    await engine.close();
    throw new Error('این ابزار فعلاً فقط با موتور تعبیه‌شده کار می‌کند؛ اتصال PostgreSQL از طریق درایور برنامه (گام ۳۲: کارگر).');
  }

  const env = loadEnv(process.env);
  const origin = env.origins.public;
  const host = new URL(origin).host;
  const server = createWebServer({
    client: createEmbeddedClient(engine),
    env,
    logger: silentLogger(),
    assetsDirectory: join(projectRoot, 'apps/web/assets'),
  });

  const respond = (path) => server.render({ method: 'GET', url: path, host });

  return {
    engine,
    server,
    origin,
    host,
    /** برای خزش پیوند. */
    async render(path) {
      const result = await respond(path);
      return { status: result.status, body: result.body, location: result.headers.location ?? null };
    },
    /** برای اندازه‌گیری: بایتِ سروشده و نوع محتوا. */
    async fetchResource(path) {
      const result = await respond(path);
      return {
        status: result.status,
        contentType: result.headers['content-type'] ?? '',
        bytes: result.bytes ?? Buffer.from(result.body, 'utf8'),
      };
    },
    async close() {
      await engine.close();
    },
  };
}
