// CLI مستقلاً اجرا می‌شود تا memory یک موتور زنده با subprocess دوم جمع نشود.
import {test,describe} from 'node:test';import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {openDatabase} from '../scripts/lib/engine.mjs';import {migrate} from '../scripts/lib/migrate.mjs';import {applySeeds} from '../scripts/lib/seed.mjs';const run=promisify(execFile);
describe('ابزار خط فرمان `npm run perf:budget`', () => {
  test('سایت سالم: جدول بودجه، رأی «قبول»، کد خروج ۰؛ صفحهٔ سنگین: «رد»، کد خروج ۱', async () => {
    const root = join(import.meta.dirname, '..');
    const dir = await mkdtemp(join(tmpdir(), 'petavu-perf-'));
    const env = { ...process.env, PETAVU_ENV: 'test', AUTH_PEPPER: 'test-pepper-value', SESSION_SECRET: 'test-session-secret-value-0123456789' };
    const cli = (extra = []) => run(process.execPath, ['scripts/perf-budget.mjs', '--data-dir', dir, ...extra], { cwd: root, env, timeout: 180_000 });
    try {
      const engine = await openDatabase({ dataDir: dir });
      await migrate(engine, { dir: join(root, 'migrations') });
      await applySeeds(engine, { dir: join(root, 'seeds') });
      await engine.close();

      const ok = await cli();
      assert.match(ok.stdout, /رأی کلی: قبول/);
      assert.match(ok.stdout, /^\/\s+\/\s/m);
      assert.match(ok.stdout, /\/:slug\s+\/rules/);

      const json = JSON.parse((await cli(['--json'])).stdout);
      assert.ok(json.rows.length >= 3);
      for (const row of json.rows) {
        assert.equal(row.verdict, 'pass', row.path);
        assert.equal(row.font_kb, Math.round((83_048 / 1024) * 10) / 10);
        assert.ok(row.not_compared.includes('lcp_ms'), 'سنجه‌های بی‌مرورگر، صادقانه «سنجیده نشده»اند');
      }

      // صفحهٔ سنگین ⇒ رد.
      let seed = 11;
      const words = Array.from({ length: 24_000 }, () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed.toString(36);
      });
      const again = await openDatabase({ dataDir: dir });
      await again.query(
        `insert into app.content (business_id, kind, slug, title, body,body_text,status, visibility, locale, published_at)
         values (null, 'page', 'heavy-page', 'سنگین', $1::jsonb,$2,'published', 'public', 'fa-IR', now())`,
        [JSON.stringify({ blocks: [{ kind: 'paragraph', text: words.join(' ') }] }),words.join(' ')],
      );
      await again.close();
      await assert.rejects(
        () => cli(['--per-pattern', '3']),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(error.stdout, /رأی کلی: رد/);
          assert.match(error.stdout, /✗ html_kb: [\d.]+ > 40/);
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
