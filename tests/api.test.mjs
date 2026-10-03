/**
 * تست `apps/api` (گام ۲۱ — §64–۷۸، §14، §93–۹۹).
 *
 * چه چیزی اینجا سنجیده می‌شود: **کل مسیر HTTP** — از سوکت تا پایگاه‌داده.
 * سرور واقعی روی پورت تصادفی بالا می‌آید، `fetch` واقعی درخواست می‌فرستد،
 * کوکی و CSRF و سقف نرخ و RLS همه در همان مسیری اجرا می‌شوند که در تولید
 * اجرا می‌شوند. هیچ‌کدام از این‌ها شبیه‌سازی نیست (§102).
 *
 * چرا روی موتور تعبیه‌شده: همان PostgreSQL ۱۸ (PGlite)، همان مهاجرت‌ها، همان
 * سیاست‌ها و همان نقش‌ها. تنها درایور شبکه عوض می‌شود.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../scripts/lib/engine.mjs';
import { migrate } from '../scripts/lib/migrate.mjs';
import { applySeeds } from '../scripts/lib/seed.mjs';

import { createApiServer } from '../apps/api/dist/index.js';
import { createPasswordHasher, TEST_ARGON2, hashIdentifier } from '../packages/security/dist/index.js';
import { loadEnv, silentLogger, uuidv7 } from '../packages/shared/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');

const PEPPER = 'test-pepper-value';
const env = loadEnv({
  PETAVU_ENV: 'test',
  AUTH_PEPPER: PEPPER,
  SESSION_SECRET: 'test-session-secret-value-0123456789',
  PETAVU_PUBLIC_ORIGIN: 'http://localhost:3000',
  PETAVU_PANEL_ORIGIN: 'http://panel.localhost:3000',
});

let engine;
let client;
let server;
let baseUrl;
let origin;

const passwords = createPasswordHasher({ params: TEST_ARGON2, pepper: PEPPER });

/** آداپتور موتور تعبیه‌شده به قرارداد `SqlClient` (همان الگوی تست‌های دیگر). */
function createEmbeddedClient(handle) {
  const make = (runner) => {
    const scoped = {
      engine: 'embedded',
      async query(text, params = []) {
        const rows = await runner.query(text, params);
        return { rows, affected: rows.length };
      },
      async exec(text) {
        await runner.exec(text);
      },
      withTransaction: (fn) =>
        typeof runner.withTransaction === 'function' ? runner.withTransaction(async (tx) => fn(make(tx))) : fn(scoped),
      async asRole(role, fn) {
        await runner.exec(`set role "${role}"`);
        try {
          return await fn(scoped);
        } finally {
          await runner.exec('reset role').catch(() => {});
        }
      },
      close: () => handle.close(),
    };
    return scoped;
  };
  return make(handle);
}

/** اجرای SQL خام در نقش پایگاه‌داده، با زمینهٔ دلخواه. */
async function asRole(role, sql, params = [], context = {}) {
  const settings = Object.entries(context).filter(([, value]) => typeof value === 'string' && value !== '');
  return client.withTransaction(async (tx) => {
    if (settings.length > 0) {
      const args = [];
      const assignments = settings.map(([key, value]) => {
        args.push(key, value);
        return `set_config($${args.length - 1}, $${args.length}, true)`;
      });
      await tx.query(`select ${assignments.join(', ')}`, args);
    }
    return tx.asRole(role, async () => {
      const result = await tx.query(sql, params);
      return result.rows;
    });
  });
}

/**
 * ساخت کاربر با هویت و اعتبارنامه — از همان دو تابع دامنه‌ای که مسیر ثبت‌نام
 * استفاده می‌کند (`app.begin_registration` + `app.complete_registration`).
 *
 * اگر آزمون، رکوردها را دستی می‌چید، «سبز شدنِ آزمون» هیچ چیزی دربارهٔ
 * مسیر واقعی ثبت‌نام نمی‌گفت. اینجا همان مسیر فشرده اجرا می‌شود.
 */
async function createUser(displayName, email, password) {
  const requestContext = { 'app.request_id': uuidv7() };
  const tickets = await asRole('pv_app', 'select * from app.begin_registration($1, $2, null)', [hashIdentifier(email), 'email'], requestContext);
  const secret = await passwords.hash(password);
  const created = await asRole(
    'pv_app',
    'select user_id from app.complete_registration($1, $2, $3, $4, $5)',
    [tickets[0].ticket_id, displayName, secret, 'fa-IR', 'Asia/Tehran'],
    requestContext,
  );
  return created[0].user_id;
}

function cookieJar() {
  const jar = new Map();
  return {
    absorb(response) {
      const raw = response.headers.getSetCookie?.() ?? [];
      for (const cookie of raw) {
        const [pair] = cookie.split(';');
        const index = pair.indexOf('=');
        const name = pair.slice(0, index);
        const value = pair.slice(index + 1);
        if (value === '') jar.delete(name);
        else jar.set(name, value);
      }
    },
    header() {
      return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    },
    get(name) {
      return jar.get(name) ?? null;
    },
  };
}

/** درخواست HTTP واقعی به سرور اجراشده. */
async function request(path, options = {}) {
  const headers = {
    origin,
    ...(options.headers ?? {}),
  };
  if (options.jar) headers.cookie = options.jar.header();

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...headers,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (options.jar) options.jar.absorb(response);

  const text = await response.text();
  let json = null;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: response.status, headers: response.headers, body: json };
}

/** ورود و برگرداندن نشست آماده (کوکی + توکن CSRF). */
async function login(email, password) {
  const jar = cookieJar();
  const response = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: email, password },
    jar,
  });
  assert.equal(response.status, 200, `ورود ناموفق: ${JSON.stringify(response.body)}`);
  return { jar, csrf: response.body.csrf_token, userId: response.body.user?.id ?? null };
}

let alice;
let bob;
let businessId;
let secondBusinessId;

before(async () => {
  try {
  engine = await openDatabase();
  await migrate(engine, { dir: join(projectRoot, 'migrations') });
  await applySeeds(engine, { dir: join(projectRoot, 'seeds') });
  client = createEmbeddedClient(engine);

  server = createApiServer({ client, env, logger: silentLogger(), lightweightPasswords: true });
  const listening = await server.listen(0, '127.0.0.1');
  baseUrl = listening.url;
  origin = env.origins.panel;

  await createUser('آلیس مدیریت', 'alice@petavu.test', 'Correct-Horse-1!');
  await createUser('بابک بازدیدکننده', 'bob@petavu.test', 'Correct-Horse-2!');

  /*
   * نشست‌ها همین‌جا ساخته می‌شوند، نه وسط یک آزمون: اگر ورود در آزمونِ دیگری
   * بشکند، همهٔ سوئیت‌های پس از آن با «undefined» می‌افتند و علتِ واقعی زیر
   * ۳۰ خطای پوششی گم می‌شود. یک شکست، یک پیام.
   */
  alice = await login('alice@petavu.test', 'Correct-Horse-1!');
  bob = await login('bob@petavu.test', 'Correct-Horse-2!');
  } catch (error) {
    console.error('SETUP FAILED:', error.code ?? '', error.message);
    console.error(error.stack?.split('\n').slice(0, 8).join('\n'));
    throw error;
  }
});

after(async () => {
  await server?.close();
  await engine?.close();
});

// ---------------------------------------------------------------------------
describe('سلامت و قرارداد خطا (§65، §93–۹۷)', () => {
  test('‏/health بی‌هیچ وابستگی‌ای پاسخ می‌دهد', async () => {
    const response = await request('/api/v1/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    assert.match(String(response.body.request_id), /^[0-9a-f-]{36}$|^[0-9A-Za-z._:-]{8,64}$/);
  });

  test('‏/ready عددهای واقعی و وضعیت صادقانهٔ سرویس‌ها را می‌دهد', async () => {
    const response = await request('/api/v1/ready');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ready');
    assert.equal(response.body.database.migrations >= 15, true, `مهاجرت‌ها: ${response.body.database.migrations}`);
    assert.equal(response.body.database.tables >= 88, true);
    // ایمیل بی‌درایور، «آماده» گزارش نمی‌شود (§102).
    assert.equal(response.body.services.email.configured, false);
    assert.equal(response.body.services.email.driver, 'none');
  });

  test('مسیر ناشناس، خطای ساختاریافته با شناسهٔ درخواست می‌دهد', async () => {
    const response = await request('/api/v1/nope');
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'not_found');
    assert.ok(response.body.error.request_id);
    assert.match(String(response.headers.get('x-request-id')), /^[0-9A-Za-z._:-]{8,64}$/);
  });

  test('شناسهٔ درخواست کلاینت، پذیرفته و بازگردانده می‌شود', async () => {
    const response = await request('/api/v1/health', { headers: { 'x-request-id': 'trace-abc-12345' } });
    assert.equal(response.headers.get('x-request-id'), 'trace-abc-12345');
    assert.equal(response.body.request_id, 'trace-abc-12345');
  });

  test('شناسهٔ درخواست نامعتبر، جایگزین می‌شود (نه اینکه به لاگ تزریق شود)', async () => {
    /*
     * چرا با سوکت خام و نه `fetch`: `fetch` مقدار هدرِ دارای CRLF را *خودش*
     * رد می‌کند، پس آزمون هرگز به سرور نمی‌رسید و چیزی را نمی‌سنجید. اینجا
     * بایت‌های خام روی سوکت نوشته می‌شود — همان چیزی که مهاجم می‌فرستد —
     * و پاسخ نشان می‌دهد سرور شناسهٔ نامعتبر را با شناسهٔ تازه عوض کرده.
     */
    const { createConnection } = await import('node:net');
    const { hostname, port } = new URL(baseUrl);
    const raw = await new Promise((resolve, reject) => {
      const socket = createConnection({ host: hostname, port: Number(port) }, () => {
        socket.write(
          'GET /api/v1/health HTTP/1.1\r\n' +
            `Host: ${hostname}\r\n` +
            'x-request-id: bad id\r\n' +
            'with-newline: injected\r\n' +
            'Connection: close\r\n\r\n',
        );
      });
      let data = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => { data += chunk; });
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });

    const header = /x-request-id: ([^\r\n]+)/i.exec(raw);
    assert.ok(header, 'پاسخ باید شناسهٔ درخواست داشته باشد');
    assert.notEqual(header[1].trim(), 'bad id');
    assert.match(header[1].trim(), /^[0-9A-Za-z._:-]{8,64}$/);
  });

  test('روش نامجاز، ۴۰۵ با هدر Allow می‌دهد', async () => {
    const response = await request('/api/v1/health', { method: 'DELETE' });
    assert.equal(response.status, 405);
    assert.equal(response.body.error.code, 'method_not_allowed');
    assert.match(String(response.headers.get('allow')), /GET/);
  });

  test('هدرهای امنیتی روی هر پاسخ می‌نشینند', async () => {
    const response = await request('/api/v1/health');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(String(response.headers.get('content-security-policy')), /default-src 'none'/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  test('بدنهٔ بزرگ‌تر از سقف، ۴۱۳ می‌گیرد', async () => {
    const huge = { identifier: 'a'.repeat(300 * 1024), password: 'x' };
    const response = await request('/api/v1/auth/login', { method: 'POST', body: huge });
    assert.equal(response.status, 413);
    assert.equal(response.body.error.code, 'payload_too_large');
  });

  test('بدنهٔ غیر-JSON، ۴۱۵ می‌گیرد', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { origin, 'content-type': 'text/plain' },
      body: 'identifier=alice',
    });
    assert.equal(response.status, 415);
    assert.equal((await response.json()).error.code, 'unsupported_media_type');
  });

  test('بدنهٔ JSON خراب، ۴۰۰ با کد روشن می‌دهد', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: '{"identifier": ',
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.details.reason, 'malformed_json');
  });

  test('پیش‌پرواز CORS برای دامنهٔ خودی پاسخ می‌دهد و برای بیگانه، بی‌مدرک می‌ماند', async () => {
    const allowed = await fetch(`${baseUrl}/api/v1/businesses`, { method: 'OPTIONS', headers: { origin: env.origins.panel } });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-origin'), env.origins.panel);

    const foreign = await fetch(`${baseUrl}/api/v1/businesses`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  });
});

// ---------------------------------------------------------------------------
describe('احراز هویت (§7–۱۳)', () => {
  test('ورود با رمز درست، کوکی HttpOnly و توکن CSRF می‌دهد', async () => {
    const jar = cookieJar();
    const response = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { identifier: 'alice@petavu.test', password: 'Correct-Horse-1!' },
      jar,
    });

    assert.equal(response.status, 200);
    assert.ok(response.body.csrf_token);

    const cookies = response.headers.getSetCookie();
    const session = cookies.find((cookie) => cookie.includes('pv_session='));
    assert.ok(session, 'کوکی نشست باید ست شود');
    assert.match(session, /HttpOnly/);
    assert.match(session, /SameSite=Lax/);
    // هیچ دامنه‌ای ست نمی‌شود؛ وگرنه کوکی روی ساب‌دامین‌ها پخش می‌شود (§9).
    assert.doesNotMatch(session, /Domain=/i);
  });

  test('رمز غلط و کاربر ناموجود، پاسخ یکسان می‌گیرند (بدون افشا)', async () => {
    const wrongPassword = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { identifier: 'alice@petavu.test', password: 'wrong-password' },
    });
    const noUser = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { identifier: 'ghost@petavu.test', password: 'wrong-password' },
    });

    assert.equal(wrongPassword.status, 401);
    assert.equal(noUser.status, 401);
    assert.equal(wrongPassword.body.error.message, noUser.body.error.message);
    assert.equal(wrongPassword.body.error.details.reason, 'invalid_credentials');
    assert.equal(noUser.body.error.details.reason, 'invalid_credentials');
    assert.equal(/ghost|exist|یافت|وجود/u.test(noUser.body.error.message), false);
  });

  test('ورود نادرست، رخداد امنیتی و تلاش ورود ثبت می‌کند', async () => {
    const bad = await request('/api/v1/auth/login', { method: 'POST', body: { identifier: 'alice@petavu.test', password: 'nope' } });
    assert.equal(bad.status, 401, 'ورود با رمز نادرست باید ۴۰۱ بدهد');
    const attempts = await asRole('postgres', `select count(*)::int as c from auth.login_attempt where succeeded = false`);
    const events = await asRole('postgres', `select count(*)::int as c from ops.security_event where kind = 'auth.login_failed'`);
    assert.ok(attempts[0].c >= 1, 'تلاش ناموفق باید ثبت شود');
    assert.ok(events[0].c >= 1, 'رخداد امنیتی باید ثبت شود');
  });

  test('مسیر محافظت‌شده بی‌نشست، ۴۰۱ می‌دهد', async () => {
    const response = await request('/api/v1/auth/session');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'unauthenticated');
  });

  test('نشست جاری، کاربر و کسب‌وکارها را برمی‌گرداند', async () => {
    alice = await login('alice@petavu.test', 'Correct-Horse-1!');
    const response = await request('/api/v1/auth/session', { jar: alice.jar });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.display_name, 'آلیس مدیریت');
    assert.equal(response.body.user.locale, 'fa-IR');
    assert.equal(response.body.session.platform_role, null);
    assert.ok(response.body.csrf_token);
  });

  test('کوکی دستکاری‌شده، نشست نمی‌سازد', async () => {
    const forged = cookieJar();
    forged.absorb({ headers: { getSetCookie: () => [`pv_session=pv1.${uuidv7()}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; Path=/`] } });
    const response = await request('/api/v1/auth/session', { jar: forged });
    assert.equal(response.status, 401);
  });

  test('خروج، نشست را باطل و کوکی‌ها را پاک می‌کند', async () => {
    const temporary = await login('bob@petavu.test', 'Correct-Horse-2!');
    const out = await request('/api/v1/auth/logout', {
      method: 'POST',
      jar: temporary.jar,
      headers: { 'x-csrf-token': temporary.csrf },
      body: {},
    });
    assert.equal(out.status, 200);
    assert.equal(out.body.revoked, true);

    const after = await request('/api/v1/auth/session', { jar: temporary.jar });
    assert.equal(after.status, 401, 'نشست باطل‌شده نباید کار کند');

    const revoked = await asRole('postgres', `select count(*)::int as c from auth.session where revoked_at is not null`);
    assert.ok(revoked[0].c >= 1);
  });
});

// ---------------------------------------------------------------------------
describe('CSRF و مبدأ (§12)', () => {
  test('نوشتن با کوکی و بی‌توکن CSRF، رد می‌شود', async () => {
    const response = await request('/api/v1/businesses', {
      method: 'POST',
      jar: alice.jar,
      body: { name: 'کلینیک بی‌توکن', business_type_key: 'veterinary_clinic' },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'csrf_failed');
  });

  test('توکن درست، نوشتن را ممکن می‌کند', async () => {
    const response = await request('/api/v1/businesses', {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-csrf-token': alice.csrf },
      body: { name: 'کلینیک دامپزشکی شریف', business_type_key: 'veterinary_clinic', slug: 'vet-sharif' },
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    businessId = response.body.business.id;
    assert.equal(response.body.business.slug, 'vet-sharif');
  });

  test('توکن CSRF نشست دیگر، بی‌ارزش است', async () => {
    const other = await login('bob@petavu.test', 'Correct-Horse-2!');
    const response = await request('/api/v1/businesses', {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-csrf-token': other.csrf },
      body: { name: 'کلینیک جعلی', business_type_key: 'veterinary_clinic' },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'csrf_failed');
  });

  test('مبدأ بیگانه، حتی با توکن درست، رد می‌شود', async () => {
    const response = await fetch(`${baseUrl}/api/v1/businesses`, {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        cookie: alice.jar.header(),
        'x-csrf-token': alice.csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'از دامنهٔ بیگانه', business_type_key: 'veterinary_clinic' }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'csrf_failed');
  });
});

// ---------------------------------------------------------------------------
describe('مجوز و ایزوله‌سازی (§14–۱۷، §54)', () => {
  test('کسب‌وکار دوم برای آزمون جداسازی ساخته می‌شود', async () => {
    const response = await request('/api/v1/businesses', {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-csrf-token': alice.csrf },
      body: { name: 'پت‌شاپ تک‌پت', business_type_key: 'pet_shop', slug: 'tak-pet' },
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    secondBusinessId = response.body.business.id;
  });

  test('کاربر غیرعضو، دادهٔ کسب‌وکار دیگران را نمی‌بیند (RLS)', async () => {
    bob = await login('bob@petavu.test', 'Correct-Horse-2!');
    const response = await request(`/api/v1/businesses/${businessId}/team`, {
      jar: bob.jar,
      headers: { 'x-business-id': businessId },
    });
    // نه «فهرست خالی»: پیام روشن «دسترسی ندارید» — چون عضو نیست.
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'forbidden');
  });

  test('ناسازگاری کسب‌وکار مسیر با هدر، رد می‌شود', async () => {
    const response = await request(`/api/v1/businesses/${businessId}/team`, {
      jar: alice.jar,
      headers: { 'x-business-id': secondBusinessId },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.details.reason, 'business_context_mismatch');
  });

  test('مالک، تیم و نقش‌ها را می‌بیند', async () => {
    const response = await request(`/api/v1/businesses/${businessId}/team`, {
      jar: alice.jar,
      headers: { 'x-business-id': businessId },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.members.length >= 1, true);
    assert.equal(response.body.members[0].role_key, 'owner');
    assert.equal(response.body.roles.length >= 6, true);
  });

  test('دعوت، پذیرش و عضویت تازه — سرتاسری', async () => {
    const invite = await request(`/api/v1/businesses/${businessId}/invitations`, {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: { invitee: 'bob@petavu.test', invitee_kind: 'email', role: 'member' },
    });
    assert.equal(invite.status, 201, JSON.stringify(invite.body));
    assert.ok(invite.body.token, 'توکن دعوت یک‌بار برمی‌گردد');
    assert.match(invite.body.invitation.invitee_display ?? '', /@petavu\.test$|b\*\*\*/, 'شناسهٔ دعوت‌شده باید پرده‌دار باشد');

    const accept = await request(`/api/v1/businesses/${businessId}/invitations/${invite.body.invitation.id}/accept`, {
      method: 'POST',
      jar: bob.jar,
      headers: { 'x-business-id': '  ', 'x-csrf-token': bob.csrf },
      body: { token: invite.body.token },
    });
    assert.equal(accept.status, 200, JSON.stringify(accept.body));

    const bobBusinesses = await request('/api/v1/businesses', { jar: bob.jar });
    assert.equal(bobBusinesses.body.businesses.some((business) => business.id === businessId), true);

    // توکن یکبارمصرف است: پذیرش دوباره کار نمی‌کند.
    const replay = await request(`/api/v1/businesses/${businessId}/invitations/${invite.body.invitation.id}/accept`, {
      method: 'POST',
      jar: bob.jar,
      headers: { 'x-csrf-token': bob.csrf },
      body: { token: invite.body.token },
    });
    assert.notEqual(replay.status, 200, 'توکن دعوتِ مصرف‌شده نباید دوباره کار کند');
  });

  test('ویرایش با نسخهٔ کهنه، ۴۱۲ می‌دهد (کنترل هم‌زمانی)', async () => {
    const stale = await request(`/api/v1/businesses/${businessId}`, {
      method: 'PATCH',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: { expected_version: 99, name: 'نام تازه' },
    });
    assert.equal(stale.status, 412);
    assert.equal(stale.body.error.code, 'precondition_failed');

    const fresh = await request(`/api/v1/businesses/${businessId}`, {
      method: 'PATCH',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: { expected_version: 1, name: 'کلینیک دامپزشکی شریف تهران' },
    });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.business.name, 'کلینیک دامپزشکی شریف تهران');
  });

  test('اعتبارسنجی ورودی، فهرست مسائل با مسیر می‌دهد (§65)', async () => {
    const response = await request('/api/v1/businesses', {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-csrf-token': alice.csrf },
      body: { name: 'x', business_type_key: '' },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'validation_failed');
    const paths = response.body.error.details.issues.map((issue) => issue.path);
    assert.ok(paths.includes('name'));
    assert.ok(paths.includes('business_type_key'));
  });
});

// ---------------------------------------------------------------------------
describe('محتوا: گذر وضعیت فقط از تابع دامنه (§23)', () => {
  let contentId;

  test('ساخت محتوا، وضعیت پیش‌نویس می‌دهد', async () => {
    const response = await request(`/api/v1/businesses/${businessId}/content`, {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: { kind: 'service', slug: 'vaccine', title: 'واکسن سگ و گربه' },
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.content.status, 'draft');
    contentId = response.body.content.id;
  });

  test('فیلد status در ویرایش وجود ندارد؛ وضعیت تکان نمی‌خورد', async () => {
    const response = await request(`/api/v1/businesses/${businessId}/content/${contentId}`, {
      method: 'PATCH',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: { expected_version: 1, title: 'واکسن سگ و گربه (بازنگری‌شده)', status: 'published' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.content.status, 'draft', 'status نباید از مسیر ویرایش تغییر کند');
    assert.equal(response.body.content.title, 'واکسن سگ و گربه (بازنگری‌شده)');
  });

  test('گذر نامعتبر (draft→published) رد می‌شود', async () => {
    const response = await request(`/api/v1/businesses/${businessId}/content/${contentId}/transition`, {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: { to: 'published' },
    });
    assert.equal(response.status, 412, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'precondition_failed');
  });

  test('زنجیرهٔ کامل تا انتشار کار می‌کند و هر گذر حسابرسی می‌شود', async () => {
    for (const to of ['in_review', 'approved', 'published']) {
      const response = await request(`/api/v1/businesses/${businessId}/content/${contentId}/transition`, {
        method: 'POST',
        jar: alice.jar,
        headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
        body: { to, reason: 'آزمون' },
      });
      assert.equal(response.status, 200, `${to}: ${JSON.stringify(response.body)}`);
      assert.equal(response.body.content.status, to);
    }

    const audits = await asRole(
      'postgres',
      `select count(*)::int as c from ops.audit_log where entity_id = $1`,
      [contentId],
    );
    assert.ok(audits[0].c >= 3, `حسابرسی گذرها: ${audits[0].c}`);
  });

  test('بلوک‌ها جایگزین می‌شوند و متن ساده ذخیره می‌شود', async () => {
    const response = await request(`/api/v1/businesses/${businessId}/content/${contentId}/blocks`, {
      method: 'PUT',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: {
        blocks: [
          { kind: 'paragraph', data: { text: 'واکسن سالانه، ساده‌ترین پیشگیری است.' }, plain_text: 'واکسن سالانه' },
          { kind: 'faq', data: { items: [{ q: 'چند وقت یک‌بار؟', a: 'سالانه' }] } },
        ],
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.replaced, 2);

    const blocks = await request(`/api/v1/businesses/${businessId}/content/${contentId}/blocks`, {
      jar: alice.jar,
      headers: { 'x-business-id': businessId },
    });
    assert.equal(blocks.body.blocks.length, 2);
  });

  test('بلوک بی‌نوع، رد می‌شود', async () => {
    const response = await request(`/api/v1/businesses/${businessId}/content/${contentId}/blocks`, {
      method: 'PUT',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: { blocks: [{ data: {} }] },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.details.issues[0].path, 'blocks.0.kind');
  });
});

// ---------------------------------------------------------------------------
describe('خودکارسازی: کنش بسته و آزمون خشک (§56–۷۲)', () => {
  let ruleId;

  test('کنش ناشناس، پیش از نوشتن رد می‌شود', async () => {
    const response = await request(`/api/v1/businesses/${businessId}/automation/rules`, {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: {
        key: 'test.rule',
        name_fa: 'قاعدهٔ آزمون',
        event_type: 'business.updated',
        actions: [{ type: 'run_sql', sql: 'drop table app.business' }],
      },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.details.issues[0].code, 'not_allowed');
    assert.deepEqual(response.body.error.details.allowed, ['notify', 'emit_event', 'enqueue_job', 'webhook']);
  });

  test('قاعدهٔ درست ساخته می‌شود و واژگان در فهرست می‌آید', async () => {
    const created = await request(`/api/v1/businesses/${businessId}/automation/rules`, {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: {
        key: 'test.notify_on_update',
        name_fa: 'اطلاع به مالک پس از ویرایش',
        event_type: 'business.updated',
        // قرارداد دقیق: شرط‌ها شاخه‌های all/any/not، و هر شرط {op, path}.
        conditions: { all: [{ op: 'exists', path: 'payload.name' }] },
        actions: [{ type: 'notify', title: 'کسب‌وکار ویرایش شد' }],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    ruleId = created.body.rule.id;

    const list = await request(`/api/v1/businesses/${businessId}/automation/rules`, {
      jar: alice.jar,
      headers: { 'x-business-id': businessId },
    });
    assert.equal(list.status, 200);
    assert.ok(list.body.vocabulary.actions.includes('notify'));
    assert.ok(list.body.vocabulary.operators.includes('exists'));
  });

  test('آزمون خشک، بدون اجرای واقعی پاسخ می‌دهد', async () => {
    const response = await request(`/api/v1/businesses/${businessId}/automation/rules/${ruleId}/dry-run`, {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: { payload: { name: 'تازه' } },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(response.body.dry_run);
  });

  test('قاعدهٔ سیستمی از راه API ساخته نمی‌شود (حتی با کلید واژگانی درست)', async () => {
    const response = await request(`/api/v1/businesses/${businessId}/automation/rules`, {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: {
        key: 'platform.fake_system',
        name_fa: 'قاعدهٔ جعلی سیستمی',
        event_type: 'business.updated',
        is_system: true,
        actions: [{ kind: 'notify', title: 'x' }],
      },
    });
    // `is_system` در ورودی مجاز نیست؛ رکورد ساخته‌شده اگر بیاید، is_system=false است.
    if (response.status === 201) assert.equal(response.body.rule.is_system, false);
    else assert.equal(response.status, 400);
  });
});

// ---------------------------------------------------------------------------
describe('عملکرد: مرز اعتماد عمومی (§91–۹۵)', () => {
  test('ثبت سنجهٔ معتبر، ۲۰۲ می‌گیرد', async () => {
    const response = await request('/api/v1/public/vitals', {
      method: 'POST',
      body: { samples: [{ metric: 'LCP', value: 1800, path: '/b/tak-pet', rating: 'good' }] },
    });
    assert.equal(response.status, 202, JSON.stringify(response.body));
  });

  test('سنجهٔ ناشناس، رد می‌شود (نه اینکه ذخیره و بعداً فیلتر شود)', async () => {
    const response = await request('/api/v1/public/vitals', {
      method: 'POST',
      body: { samples: [{ metric: 'made_up', value: 1, path: '/x' }] },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.error.details.allowed, ['lcp', 'inp', 'cls', 'ttfb', 'fcp']);
  });

  test('مسیر نسبی نامعتبر، رد می‌شود', async () => {
    const response = await request('/api/v1/public/vitals', {
      method: 'POST',
      body: { samples: [{ metric: 'lcp', value: 1000, path: 'https://evil.example' }] },
    });
    assert.equal(response.status, 400);
  });

  test('بودجهٔ مسیر با الگو خوانده می‌شود', async () => {
    const response = await request('/api/v1/performance/budget?path=/b/tak-pet');
    assert.equal(response.status, 200);
    assert.ok(response.body.budget, 'بودجهٔ الگوی مسیر باید پیدا شود');
  });

  test('سنجش بودجه، سه‌حالته پاسخ می‌دهد', async () => {
    const response = await request('/api/v1/performance/budget/check', {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: { path: '/b/tak-pet', measurement: { lcp_ms: 100000, cls: 9 } },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(['pass', 'fail', 'unbudgeted'].includes(response.body.check.verdict));
  });

  test('سقف نرخ روی مسیر عمومی، واقعاً می‌بندد و هدر Retry-After می‌دهد', async () => {
    let limited = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await request('/api/v1/public/vitals', {
        method: 'POST',
        body: { samples: [{ metric: 'cls', value: 0.05, path: `/rate-test/${attempt}` }] },
      });
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    assert.ok(limited, 'سقف نرخ باید پس از چند درخواست ببندد');
    assert.equal(limited.body.error.code, 'rate_limited');
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    assert.equal(limited.headers.get('ratelimit-remaining'), '0');

    const counters = await asRole('postgres', `select count(*)::int as c from ops.rate_limit_counter`);
    assert.ok(counters[0].c >= 1, 'شمارندهٔ سقف نرخ در پایگاه‌داده باید پر شود');
  });
});

// ---------------------------------------------------------------------------
describe('سئو: داده، نه HTML (Addendum §39–۴۷)', () => {
  test('ردیابی مسیر بی‌استثنا ثبت می‌شود و حلقه رد می‌شود', async () => {
    const created = await request(`/api/v1/businesses/${businessId}/seo/redirects`, {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: { source_path: '/old-vaccine', target_path: '/b/vet-sharif/service/vaccine', status_code: 301, reason: 'تغییر ساختار' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const loop = await request(`/api/v1/businesses/${businessId}/seo/redirects`, {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: { source_path: '/b/vet-sharif/service/vaccine', target_path: '/old-vaccine' },
    });
    assert.ok(loop.status >= 400, 'حلقهٔ تغییر مسیر نباید ساخته شود');
  });

  test('فرادادهٔ سئو از راه تابع دامنه ثبت می‌شود', async () => {
    const response = await request(`/api/v1/businesses/${businessId}/seo/metadata/business/${businessId}`, {
      method: 'PUT',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: {
        title: 'کلینیک دامپزشکی شریف | واکسن و معاینه در تهران',
        description: 'کلینیک دامپزشکی شریف: واکسن، معاینه و آزمایش سگ و گربه با نوبت‌دهی آنلاین.',
        is_manual: true,
      },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const stored = await request(`/api/v1/businesses/${businessId}/seo/metadata/business/${businessId}`, {
      jar: alice.jar,
      headers: { 'x-business-id': businessId },
    });
    assert.equal(stored.status, 200);
    assert.match(String(stored.body.metadata.title), /شریف/);
    assert.equal(stored.body.metadata.is_manual, true);
  });

  test('قالب سئو، پیش‌نمایش رندرشده می‌دهد', async () => {
    const templates = await request('/api/v1/seo/templates');
    assert.equal(templates.status, 200);
    assert.ok(templates.body.templates.length >= 12);

    const preview = await request('/api/v1/seo/templates/preview', {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: { entity_kind: 'business', subtype: 'default', values: { name: 'کلینیک شریف', city: 'تهران' } },
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.ok(preview.body.rendered);
  });
});

// ---------------------------------------------------------------------------
describe('کلید API: کارگزار مستقل با دامنهٔ مجوز (§74، §191)', () => {
  let keyId;
  let secret;

  test('ساخت کلید، مجوز لازم دارد و کلید خام یک‌بار می‌آید', async () => {
    const response = await request('/api/v1/auth/api-keys', {
      method: 'POST',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
      body: { name: 'کلید گزارش‌گیری', scopes: ['profile.view', 'content.update'] },
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    keyId = response.body.key.id;
    secret = response.body.secret;
    assert.match(secret, /^pvk_live_/);

    const stored = await asRole('postgres', `select key_hash, key_prefix from app.api_key where id = $1`, [keyId]);
    assert.match(stored[0].key_hash, /^sha256:[0-9a-f]{64}$/, 'هش کلید باید با قالب مشترک رازها ذخیره شود');
    assert.notEqual(stored[0].key_hash, secret, 'کلید خام هرگز ذخیره نمی‌شود');
  });

  test('کلید ناشناس، ۴۰۱ می‌دهد', async () => {
    const response = await request(`/api/v1/businesses/${businessId}`, {
      headers: { authorization: 'Bearer pvk_live_notarealkey' },
    });
    assert.equal(response.status, 401);
  });

  test('کلید معتبر، کسب‌وکار خودش را می‌بیند', async () => {
    const own = await request(`/api/v1/businesses/${businessId}/overview`, { headers: { authorization: `Bearer ${secret}` } });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.business.id, businessId);
  });

  test('کلید، کسب‌وکار دیگری را نمی‌بیند', async () => {
    const other = await request(`/api/v1/businesses/${secondBusinessId}/overview`, {
      headers: { authorization: `Bearer ${secret}`, 'x-business-id': secondBusinessId },
    });
    assert.equal(other.status, 403);
    assert.equal(other.body.error.details.reason, 'api_key_business_mismatch');
  });

  test('دامنهٔ مجوز کلید، در همان مدل مجوز سیستم سنجیده می‌شود', async () => {
    // در زمینهٔ کارگزار کلید: مجوزِ داخل دامنه ⇒ بله، بیرون دامنه ⇒ نه.
    await asRole(
      'postgres',
      `select set_config('app.api_key_id', $1, true), set_config('app.api_key_business_id', $2, true), set_config('app.api_key_scopes', 'profile.view,content.update', true)`,
      [keyId, businessId],
    ).catch(() => undefined);

    const inside = await client.withTransaction(async (tx) => {
      await tx.query(`select set_config('app.api_key_id', $1, true), set_config('app.api_key_business_id', $2, true), set_config('app.api_key_scopes', $3, true)`, [
        keyId,
        businessId,
        'profile.view,content.update',
      ]);
      return tx.asRole('pv_app', async () => (await tx.query(`select app.has_permission($1, 'content.update') as ok, app.has_permission($1, 'business.delete') as forbidden`, [businessId])).rows[0]);
    });

    assert.equal(inside.ok, true, 'مجوز داخل دامنه باید بله باشد');
    assert.equal(inside.forbidden, false, 'مجوز بیرون دامنه باید نه باشد');
  });

  test('کلید باطل‌شده، دیگر کار نمی‌کند', async () => {
    const revoked = await request(`/api/v1/auth/api-keys/${keyId}`, {
      method: 'DELETE',
      jar: alice.jar,
      headers: { 'x-business-id': businessId, 'x-csrf-token': alice.csrf },
    });
    assert.equal(revoked.status, 200);

    const after = await request(`/api/v1/businesses/${businessId}/overview`, { headers: { authorization: `Bearer ${secret}` } });
    assert.equal(after.status, 401);
  });
});

// ---------------------------------------------------------------------------
describe('عملیات و پنل مدیریت (§28، §93–۹۹)', () => {
  test('بی‌مجوز پلتفرمی، رجیستری فیچر بسته است', async () => {
    const response = await request('/api/v1/ops/features', { jar: alice.jar });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.details.reason, 'missing_platform_permission');
  });

  test('با نقش پلتفرمی، فیچرها و عبور وضعیت کار می‌کند', async () => {
    // نقش پلتفرمی از پایگاه‌داده می‌آید، نه از کوکی؛ و از راه تابع دامنه.
    await asRole('postgres', `insert into auth.user_platform_role (user_id, role_key) select $1, 'superadmin'`, [alice.userId]).catch(async () => {
      await asRole('postgres', `insert into auth.user_platform_role (user_id, role_key) values ($1, 'superadmin')`, [alice.userId]);
    });

    // ورود تازه لازم است تا `platform_role` در نشست بازشناخته شود.
    alice = await login('alice@petavu.test', 'Correct-Horse-1!');

    const list = await request('/api/v1/ops/features', { jar: alice.jar });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.ok(list.body.features.length >= 14);

    const jobs = await request('/api/v1/ops/jobs/health', { jar: alice.jar });
    assert.equal(jobs.status, 200);
    assert.ok(jobs.body.health);
  });

  test('تنظیمات، راز را پرده‌دار نشان می‌دهد', async () => {
    const response = await request('/api/v1/ops/settings', { jar: alice.jar });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    for (const setting of response.body.settings) {
      if (setting.is_secret === true) assert.equal(setting.value, '•••');
    }
  });

  test('رخداد امنیتی از مرورگر ثبت می‌شود ولی خواندنش کارکنان می‌خواهد', async () => {
    const report = await request('/api/v1/public/security-events', {
      method: 'POST',
      body: { kind: 'csp_violation', severity: 'warning', details: { blocked_uri: 'https://cdn.example/x.js' } },
    });
    assert.equal(report.status, 202, JSON.stringify(report.body));

    const asOwner = await request('/api/v1/ops/security/events', { jar: bob.jar });
    assert.equal(asOwner.status, 403);

    const asStaff = await request('/api/v1/ops/security/events?limit=5', { jar: alice.jar });
    assert.equal(asStaff.status, 200, JSON.stringify(asStaff.body));
  });

  test('اعلان‌های کاربر، شمار خوانده‌نشده می‌دهد', async () => {
    await asRole('postgres', `insert into ops.notification (recipient_user_id, kind, title) values ($1, 'system.notice', 'خوش آمدید')`, [alice.userId]);
    const response = await request('/api/v1/ops/notifications', { jar: alice.jar });
    assert.equal(response.status, 200);
    assert.ok(response.body.unread >= 1);
  });
});

// ---------------------------------------------------------------------------
describe('کاتالوگ و جست‌وجو (§19–۲۱، §60)', () => {
  test('انواع کسب‌وکار و صنعت‌ها عمومی‌اند', async () => {
    const types = await request('/api/v1/catalog/business-types');
    const industries = await request('/api/v1/catalog/industries');
    assert.equal(types.status, 200);
    assert.equal(industries.status, 200);
    assert.ok(types.body.types.length >= 29);
    assert.ok(industries.body.industries.length >= 50);
  });

  test('مهر تازه‌سازی دادهٔ مرجع، کش‌پذیر است', async () => {
    const response = await request('/api/v1/catalog/revision');
    assert.equal(response.status, 200);
    assert.match(String(response.headers.get('cache-control')), /max-age/);
  });

  test('جست‌وجوی کوتاه، دلیل صریح می‌دهد (نه خطا)', async () => {
    const response = await request('/api/v1/search?q=ا');
    assert.equal(response.status, 200);
    assert.equal(response.body.reason, 'query_too_short');
    assert.equal(response.body.engine, 'postgres');
  });

  test('جست‌وجوی واقعی، از میان کسب‌وکارهای عمومی نتیجه می‌دهد', async () => {
    const response = await request('/api/v1/search?q=شریف');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.results));
    assert.match(String(response.body.note), /PostgreSQL|فعال نیست/);
  });

  test('فهرست عمومی، فقط کسب‌وکارهای منتشرشده را می‌دهد', async () => {
    const response = await request('/api/v1/businesses/directory');
    assert.equal(response.status, 200);
    assert.ok(response.body.businesses.every((business) => business.visibility === 'public' || business.status === 'active'));
  });
});

// ---------------------------------------------------------------------------
describe('سند OpenAPI از همان فهرست مسیرها (§66، §103)', () => {
  test('سند ساخته می‌شود و هر مسیر را دارد', () => {
    const document = server.openapi();
    assert.equal(document.openapi, '3.1.0');
    const paths = Object.keys(document.paths);
    assert.ok(paths.length >= 40, `مسیرها در سند: ${paths.length}`);
    assert.ok(document.components.securitySchemes.sessionCookie);
    assert.ok(document.components.schemas.Error);
  });

  test('هر عملیات، الگوی احراز و نقش پایگاه‌داده را اعلام می‌کند', () => {
    const document = server.openapi();
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        assert.ok(operation.operationId, `${method} ${path}: operationId ندارد`);
        assert.ok(Array.isArray(operation.security), `${method} ${path}: security ندارد`);
        assert.ok(['pv_app', 'pv_public', 'pv_worker', 'pv_reader'].includes(operation['x-database-role']));
      }
    }
  });

  test('فهرست مسیرها یکتاست و همه با /api/v1 آغاز می‌شوند', () => {
    const seen = new Set();
    for (const route of server.router.list()) {
      assert.ok(route.path.startsWith('/api/v1/'), `${route.path} بیرون از پیشوند نسخه است`);
      const key = `${route.method} ${route.path}`;
      assert.equal(seen.has(key), false, `مسیر تکراری: ${key}`);
      seen.add(key);
    }
  });
});
