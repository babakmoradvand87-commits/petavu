// CLI مستقلاً اجرا می‌شود تا memory یک موتور زنده با subprocess دوم جمع نشود.
import {test,describe} from 'node:test';import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {openDatabase} from '../scripts/lib/engine.mjs';import {migrate} from '../scripts/lib/migrate.mjs';import {applySeeds} from '../scripts/lib/seed.mjs';const run=promisify(execFile);
describe('ابزار خط فرمان `npm run seo:crawl`', () => {
  test('سایت سالم: گزارش و ثبت؛ و با پیوند شکسته، کد خروج ۱ — «انتشار نکن»', async () => {
    const root = join(import.meta.dirname, '..');
    const dir = await mkdtemp(join(tmpdir(), 'petavu-crawl-'));
    const env = { ...process.env, PETAVU_ENV: 'test', AUTH_PEPPER: 'test-pepper-value', SESSION_SECRET: 'test-session-secret-value-0123456789' };
    const cli = (extra = []) => run(process.execPath, ['scripts/seo-crawl.mjs', '--data-dir', dir, ...extra], { cwd: root, env, timeout: 120_000 });
    try {
      const engine = await openDatabase({ dataDir: dir });
      await migrate(engine, { dir: join(root, 'migrations') });
      await applySeeds(engine, { dir: join(root, 'seeds') });

      // ---- سایتِ سالم (فقط دادهٔ seed): گزارش بی‌خطا، ثبتِ بی‌ردیف.
      await engine.close();
      const report = await cli();
      assert.match(report.stdout, /نقشهٔ سایت: \d+ نشانی/);
      assert.match(report.stdout, /پیوند شکسته: 0/);
      assert.match(report.stdout, /یتیم: 0/);
      const written = await cli(['--write']);
      assert.match(written.stdout, /ثبت: \{"orphan_page":\{"opened":0,"updated":0,"closed":0\},"broken_link":\{"opened":0,"updated":0,"closed":0\}\}/);

      // ---- محتوایی که به صفحهٔ ناموجود پیوند می‌دهد: پیوند شکسته ⇒ کد خروج ۱ و ثبتِ فرصت.
      const again = await openDatabase({ dataDir: dir });
      await again.exec(
        `insert into app.content (business_id, kind, slug, title, body,body_text,status, visibility, locale, published_at)
         values (null, 'page', 'bad-links', 'صفحهٔ دارای پیوند مرده',
                 '{"blocks":[{"kind":"paragraph","text":"این صفحه محتوای کافی و معنادار برای خزش آزمایشی دارد؛ لینک داده‌ای آن عمداً خراب است تا خروجی و ثبت واقعی فرصت سنجیده شود."},{"kind":"cta","href":"/gone-page","label":"مرده"}]}'::jsonb,repeat('محتوای معنادار برای آزمایش خزش ',8),'published', 'public', 'fa-IR', now())`,
      );
      await again.close();

      await assert.rejects(
        () => cli(['--write']),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(error.stdout, /پیوند شکسته: 1/);
          assert.match(error.stdout, /\/bad-links → \/gone-page \(404\)/);
          assert.match(error.stdout, /"broken_link":\{"opened":1/);
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

