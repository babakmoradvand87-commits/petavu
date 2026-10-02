/**
 * تست‌های `@petavu/security`.
 *
 * رویکرد: هر تست یک «ادعای امنیتی» را می‌سنجد، نه یک تابع را. اگر تست سبز شد،
 * یعنی آن ادعا برقرار است؛ اگر کسی کد را تغییر داد و ادعا شکست، همین‌جا می‌شکند
 * و نه در محیط واقعی.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createPasswordHasher,
  checkPasswordPolicy,
  parseStored,
  dummyVerify,
  DEFAULT_ARGON2,
  TEST_ARGON2,
  PASSWORD_SCHEME,
  mintSessionToken,
  parseSessionToken,
  verifySessionSecret,
  hashToken,
  hashIdentifier,
  signToken,
  verifyToken,
  signBody,
  verifyBodySignature,
  numericCode,
  recoveryCode,
  normalizeRecoveryCode,
  serializeCookie,
  clearCookie,
  readCookie,
  sessionCookieName,
  sessionCookie,
  csrfCookie,
  issueCsrfToken,
  verifyCsrfToken,
  checkRequestOrigin,
  safeOriginOf,
  RateLimiter,
  MemoryRateLimitStore,
  RATE_LIMITS,
  riskAdjusted,
  riskFactor,
  limitKeys,
  rateLimitHeaders,
} from '../packages/security/dist/index.js';

import { uuidv7 } from '../packages/shared/dist/index.js';

const hasher = createPasswordHasher({ params: TEST_ARGON2 });
const peppered = createPasswordHasher({ params: TEST_ARGON2, pepper: 'server-side-pepper-value-32-chars-min' });

describe('رمز عبور (§10)', () => {
  test('درهم Argon2id ساخته می‌شود و الگوریتم داخل خودش ثبت است', async () => {
    const stored = await hasher.hash('Sup3rSecret!42');
    assert.ok(stored.startsWith(`${PASSWORD_SCHEME}$n$$argon2id$`), stored);
    assert.ok(stored.includes('m=8192,t=1,p=1'));
  });

  test('رمز درست تأیید و رمز غلط رد می‌شود', async () => {
    const stored = await hasher.hash('Sup3rSecret!42');
    assert.equal(await hasher.verify(stored, 'Sup3rSecret!42'), true);
    assert.equal(await hasher.verify(stored, 'Sup3rSecret!43'), false);
    assert.equal(await hasher.verify(stored, ''), false);
  });

  test('هر درهم نمک تازه دارد؛ دو رمز یکسان، دو درهم متفاوت', async () => {
    const first = await hasher.hash('SamePassword!1');
    const second = await hasher.hash('SamePassword!1');
    assert.notEqual(first, second);
    assert.equal(await hasher.verify(first, 'SamePassword!1'), true);
    assert.equal(await hasher.verify(second, 'SamePassword!1'), true);
  });

  test('فلفل: درهم بدون فلفل، با فلفل تأیید نمی‌شود (و برعکس)', async () => {
    const plain = await hasher.hash('Sup3rSecret!42');
    const withPepper = await peppered.hash('Sup3rSecret!42');
    assert.ok(withPepper.startsWith(`${PASSWORD_SCHEME}$p$`));
    assert.equal(await peppered.verify(withPepper, 'Sup3rSecret!42'), true);
    // مسیر تأیید از نشانگر درون خود درهم پیروی می‌کند، نه از پیکربندی لحظه‌ای؛
    // وگرنه مهاجرت از «بی‌فلفل» به «فلفل‌دار» همهٔ کاربران را قفل می‌کرد.
    assert.equal(await hasher.verify(withPepper, 'Sup3rSecret!42'), false, 'درهم فلفل‌دار بدون فلفل باز نمی‌شود');
    assert.equal(await peppered.verify(plain, 'Sup3rSecret!42'), true, 'درهم بی‌فلفل همچنان معتبر است');
    assert.equal(hasher.needsRehash(plain), false);
    assert.equal(peppered.needsRehash(plain), true, 'باید برای بازدرهم‌سازی با فلفل علامت بخورد');
  });

  test('درهم خراب یا ناشناخته، «ناموفق» است و خطا نمی‌دهد', async () => {
    for (const broken of ['', 'x', 'not-a-hash', `${PASSWORD_SCHEME}$n$`, `${PASSWORD_SCHEME}$q$$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA`, 'bcrypt$2b$10$abc']) {
      assert.equal(await hasher.verify(broken, 'anything'), false, `ورودی: ${broken}`);
    }
  });

  test('رمز خیلی بلند، خطای ۴۰۰ می‌دهد نه ۵۰۰', async () => {
    await assert.rejects(() => hasher.hash('x'.repeat(201)), (error) => error.code === 'validation_failed');
    const stored = await hasher.hash('ok-password-123');
    assert.equal(await hasher.verify(stored, 'x'.repeat(201)), false);
  });

  test('needsRehash وقتی پارامترها سخت‌تر شوند true می‌شود', async () => {
    const stored = await hasher.hash('Sup3rSecret!42');
    assert.equal(hasher.needsRehash(stored), false);

    const stronger = createPasswordHasher({ params: { memoryCost: 65_536, timeCost: 4, parallelism: 1 } });
    assert.equal(stronger.needsRehash(stored), true, 'پارامتر بالاتر باید بازدرهم‌سازی را بخواهد');

    const weaker = createPasswordHasher({ params: { memoryCost: 19_456, timeCost: 2, parallelism: 1 } });
    assert.equal(weaker.needsRehash(stored), true, 'پارامتر پایین‌تر هم باید بازدرهم‌سازی را بخواهد');

    assert.equal(hasher.needsRehash('garbage'), true);
    assert.equal(peppered.needsRehash(stored), true, 'تغییر وضعیت فلفل باید بازدرهم‌سازی بخواهد');
  });

  test('کف امن Argon2 پایین‌تر از OWASP پذیرفته نمی‌شود', () => {
    assert.throws(() => createPasswordHasher({ params: { memoryCost: 1_024, timeCost: 1, parallelism: 1 } }), RangeError);
    assert.equal(DEFAULT_ARGON2.memoryCost >= 19_456, true);
    assert.ok(DEFAULT_ARGON2.timeCost >= 2);
    assert.equal(TEST_ARGON2.memoryCost < DEFAULT_ARGON2.memoryCost, true);
  });

  test('تجزیهٔ رشتهٔ درهم، پارامترها را درست می‌خواند', async () => {
    const stored = await hasher.hash('Sup3rSecret!42');
    const parsed = parseStored(stored);
    assert.ok(parsed);
    assert.equal(parsed.scheme, PASSWORD_SCHEME);
    assert.equal(parsed.peppered, false);
    assert.equal(parsed.params?.memoryCost, TEST_ARGON2.memoryCost);
    assert.equal(parsed.params?.timeCost, TEST_ARGON2.timeCost);
    assert.equal(parsed.params?.type, 2, 'باید Argon2id باشد، نه Argon2i یا Argon2d');
  });

  test('تأیید ساختگی، زمان پاسخ را یکسان می‌کند (§13)', async () => {
    const started = performance.now();
    const result = await dummyVerify(hasher, 'هر-رمزی');
    const elapsed = performance.now() - started;
    assert.equal(result, false);
    assert.ok(elapsed >= 1, `بررسی ساختگی باید واقعاً محاسبه کند؛ طول کشید: ${elapsed.toFixed(2)}ms`);
  });
});

describe('سیاست رمز عبور (§10)', () => {
  test('طول کوتاه رد می‌شود', () => {
    const result = checkPasswordPolicy('کوتاه');
    assert.equal(result.ok, false);
    assert.ok(result.problems[0]?.includes('۱۰') || result.problems[0]?.includes('10'));
  });

  test('رمزهای رایج و ساده رد می‌شوند', () => {
    assert.equal(checkPasswordPolicy('password123').ok, false);
    assert.equal(checkPasswordPolicy('1234567890').ok, false, 'فقط رقم');
    assert.equal(checkPasswordPolicy('aaaaaaaaaaa').ok, false, 'تکرار یک نویسه');
    assert.equal(checkPasswordPolicy('PASSWORD123').ok, false, 'با حروف بزرگ هم همان رمز رایج است');
  });

  test('اطلاعات شخصی در رمز پذیرفته نمی‌شود', () => {
    const result = checkPasswordPolicy('AliReza0912!@#', { personalInfo: ['alireza0912'] });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes('اطلاعات شخصی')));
  });

  test('رمز خوب پذیرفته می‌شود', () => {
    const result = checkPasswordPolicy('باران-سبز-کوچک-۴۲');
    assert.equal(result.ok, true, result.problems.join(' | '));
  });

  test('رمز بلندتر از سقف رد می‌شود (جلوی هزینهٔ محاسباتی)', () => {
    assert.equal(checkPasswordPolicy('x'.repeat(201)).ok, false);
  });
});

describe('توکن نشست (§11)', () => {
  test('توکن نشست از شناسهٔ عمومی و راز ساخته می‌شود', () => {
    const sessionId = uuidv7();
    const minted = mintSessionToken(sessionId);
    assert.equal(minted.sessionId, sessionId);
    assert.ok(minted.token.startsWith(`pv1.${sessionId}.`));
    assert.equal(minted.secretHash.startsWith('sha256:'), true);
    assert.equal(minted.token.includes(minted.secretHash), false, 'درهم نباید داخل توکن باشد');
  });

  test('توکن معتبر تجزیه می‌شود و توکن دست‌کاری‌شده نه', () => {
    const sessionId = uuidv7();
    const { token } = mintSessionToken(sessionId);
    const parsed = parseSessionToken(token);
    assert.equal(parsed?.sessionId, sessionId);

    const [version, id, secret] = token.split('.');
    const cases = [
      '',
      'pv1',
      `pv2.${id}.${secret}`,
      `pv1.not-a-uuid.${secret}`,
      `pv1.${id}.`,
      `pv1.${id}.short`,
      `pv1.${id}.${secret}.extra`,
      `pv1.${id}.${secret.replace('-', '+')}`,
    ];
    for (const bad of cases) assert.equal(parseSessionToken(bad), null, `ورودی: ${bad}`);
    assert.equal(parseSessionToken(`${version}.${id}.${secret}`)?.secret, secret);
  });

  test('راز نشست فقط با درهم خودش و به‌صورت ثابت‌زمان می‌خورد', () => {
    const { token, secretHash } = mintSessionToken(uuidv7());
    const secret = token.split('.')[2];
    assert.equal(verifySessionSecret(secretHash, secret), true);
    assert.equal(verifySessionSecret(secretHash, `${secret}x`), false);
    assert.equal(verifySessionSecret(secretHash, ''), false);
  });

  test('درهم توکن بازگشت‌ناپذیر و قطعی است', () => {
    const token = 'pv1.example';
    assert.equal(hashToken(token), hashToken(token));
    assert.equal(hashToken(token).includes(token), false);
    assert.notEqual(hashToken('a'), hashToken('b'));
  });

  test('درهم شناسه برای کلید محدودیت نرخ، یک‌طرفه است', () => {
    const digest = hashIdentifier('+98 912 000 0000');
    assert.equal(digest.length, 64);
    assert.equal(digest.includes('912'), false);
    assert.equal(hashIdentifier('+989120000000'), hashIdentifier('+98 912 000 0000'), 'فاصله نباید فرق کند');
  });
});

describe('توکن امضاشده (§11، §16)', () => {
  const secret = 'test-secret-with-enough-entropy-123456';
  const nowMs = Date.parse('2026-01-01T00:00:00.000Z');

  test('توکن سالم تأیید می‌شود', () => {
    const token = signToken({ secret, purpose: 'email_verify', payload: { userId: 'u1' }, expiresInMs: 3600_000, nowMs });
    const result = verifyToken(token, { secret, purpose: 'email_verify', nowMs });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.token.payload, { userId: 'u1' });
      assert.equal(result.token.purpose, 'email_verify');
    }
  });

  test('جابه‌جایی هدف (token confusion) گرفته می‌شود', () => {
    const token = signToken({ secret, purpose: 'email_verify', payload: { userId: 'u1' }, expiresInMs: 3600_000, nowMs });
    const usedElsewhere = verifyToken(token, { secret, purpose: 'password_reset', nowMs });
    assert.equal(usedElsewhere.ok, false);
    const confusion = verifyToken(token, { secret, purpose: 'password_reset', nowMs });
    assert.equal(confusion.ok, false);
    // امضا سالم است (چون روی purpose خودِ توکن است)، ولی هدف نمی‌خواند.
    if (!confusion.ok) assert.equal(confusion.reason, 'purpose');
  });

  test('دست‌کاری محتوا و امضا گرفته می‌شود', () => {
    const token = signToken({ secret, purpose: 'invite', payload: { businessId: 'bz1' }, expiresInMs: 3600_000, nowMs });
    const [body, exp, purpose, signature] = token.split('.');
    const forgedBody = signToken({ secret, purpose: 'invite', payload: { businessId: 'bz2' }, expiresInMs: 3600_000, nowMs }).split('.')[0];
    for (const bad of [`${forgedBody}.${exp}.${purpose}.${signature}`, `${body}.${exp}.${purpose}.${signature}x`, `${body}.${exp}.${purpose}`, 'abc']) {
      const result = verifyToken(bad, { secret, purpose: 'invite', nowMs });
      assert.equal(result.ok, false, `ورودی: ${bad}`);
    }
  });

  test('راز اشتباه پذیرفته نمی‌شود', () => {
    const token = signToken({ secret, purpose: 'invite', payload: {}, expiresInMs: 1000, nowMs });
    const result = verifyToken(token, { secret: `${secret}x`, purpose: 'invite', nowMs });
    assert.equal(result.ok, false);
  });

  test('انقضا درست بررسی می‌شود', () => {
    const token = signToken({ secret, purpose: 'invite', payload: {}, expiresInMs: 60_000, nowMs });
    assert.equal(verifyToken(token, { secret, purpose: 'invite', nowMs: nowMs + 59_000 }).ok, true);
    const expired = verifyToken(token, { secret, purpose: 'invite', nowMs: nowMs + 61_000 });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.reason, 'expired');
  });

  test('امضای بدنهٔ درخواست (وب‌هوک) درست کار می‌کند', () => {
    const body = JSON.stringify({ event: 'order.paid', id: 'o1' });
    const signature = signBody(secret, body);
    assert.equal(verifyBodySignature(secret, body, signature), true);
    assert.equal(verifyBodySignature(secret, `${body} `, signature), false);
    assert.equal(verifyBodySignature(`${secret}x`, body, signature), false);
    assert.equal(verifyBodySignature(secret, body, signature.toUpperCase()), false);
  });

  test('کد عددی، طول و شکل درست دارد', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = numericCode(6);
      assert.match(code, /^\d{6}$/);
    }
    assert.throws(() => numericCode(3), RangeError);
    assert.throws(() => numericCode(11), RangeError);
  });

  test('کد بازیابی خوانا است و نرمال‌سازی‌اش پایدار', () => {
    const code = recoveryCode();
    assert.match(code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    assert.equal(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' ')), normalizeRecoveryCode(code));
    assert.equal(/[O0I1]/.test(code), false, 'نویسه‌های شبیه‌به‌هم نباید بیایند');
  });
});

describe('کوکی‌ها (§9)', () => {
  test('کوکی نشست همهٔ ویژگی‌های امن را دارد', () => {
    const value = sessionCookie('pv_session', 'pv1.id.secret', { secure: true, maxAgeSeconds: 3600 });
    assert.ok(value.includes('HttpOnly'));
    assert.ok(value.includes('Secure'));
    assert.ok(value.includes('SameSite=Lax'));
    assert.ok(value.includes('Path=/'));
    assert.ok(value.includes('Max-Age=3600'));
  });

  test('پخش روی دامنهٔ مادر به‌کل ممکن نیست', () => {
    assert.throws(() => serializeCookie('a', 'b', { domain: 'petavu.ir' }), (error) => error.code === 'internal_error');
    const value = serializeCookie('pv_session', 'x', { secure: true });
    assert.equal(value.includes('Domain'), false, 'هیچ کوکی‌ای نباید Domain داشته باشد');
  });

  test('پیشوند امن فقط با Secure و Path=/ پذیرفته می‌شود', () => {
    assert.equal(sessionCookieName('pv_session', true), '__Host-pv_session');
    assert.equal(sessionCookieName('pv_session', false), 'pv_session');
    assert.throws(() => serializeCookie('__Host-x', 'v', { secure: false }), (error) => error.code === 'internal_error');
    assert.throws(() => serializeCookie('__Host-x', 'v', { secure: true, path: '/panel' }), (error) => error.code === 'internal_error');
    assert.ok(serializeCookie('__Host-x', 'v', { secure: true }).includes('__Host-x=v'));
  });

  test('نام کوکی نامعتبر رد می‌شود (جلوی تزریق هدر)', () => {
    for (const bad of ['a b', 'a=b', 'a;b', 'a\nb', '']) {
      assert.throws(() => serializeCookie(bad, 'v'), TypeError, `نام: ${bad}`);
    }
  });

  test('مقدار کوکی درصدگذاری می‌شود', () => {
    const value = serializeCookie('pv_session', 'a;b=c d', { secure: true });
    assert.ok(value.includes('a%3Bb%3Dc%20d'));
  });

  test('کوکی CSRF عمداً HttpOnly نیست تا مرورگر بتواند بخواند', () => {
    const value = csrfCookie('pv_csrf', 'nonce.1.sig', { secure: true, maxAgeSeconds: 600 });
    assert.equal(value.includes('HttpOnly'), false);
    assert.ok(value.includes('SameSite=Lax'));
    assert.ok(value.includes('Secure'));
  });

  test('پاک کردن کوکی، منقضی و خالی است', () => {
    const value = clearCookie('pv_session', { secure: true });
    assert.ok(value.includes('pv_session=;'));
    assert.ok(value.includes('Max-Age=0'));
    assert.ok(value.includes('Expires=Thu, 01 Jan 1970'));
  });

  test('خواندن کوکی از هدر مقاوم است', () => {
    const header = 'a=1; pv_session=pv1.id.secret; b=2';
    assert.equal(readCookie(header, 'pv_session'), 'pv1.id.secret');
    assert.equal(readCookie(header, 'missing'), null);
    assert.equal(readCookie(undefined, 'pv_session'), null);
    assert.equal(readCookie('pv_session=%E0%A4%A', 'pv_session'), null, 'درصدگذاری خراب → نامعتبر');
    assert.equal(readCookie('pv_session=a%20b', 'pv_session'), 'a b');
  });
});

describe('CSRF (§12)', () => {
  const secret = 'csrf-secret-for-tests-1234567890';
  const sessionId = uuidv7();
  const nowMs = Date.parse('2026-01-01T00:00:00.000Z');

  test('توکن برای همین نشست تأیید می‌شود', () => {
    const token = issueCsrfToken({ secret, sessionId, nowMs });
    assert.equal(verifyCsrfToken(token, { secret, sessionId, nowMs }).ok, true);
  });

  test('توکن نشست دیگر بی‌ارزش است', () => {
    const token = issueCsrfToken({ secret, sessionId, nowMs });
    const result = verifyCsrfToken(token, { secret, sessionId: uuidv7(), nowMs });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'session_mismatch');
  });

  test('توکن دست‌کاری‌شده و بی‌امضا رد می‌شود', () => {
    const token = issueCsrfToken({ secret, sessionId, nowMs });
    const [nonce, exp, signature] = token.split('.');
    const forged = issueCsrfToken({ secret: 'other-secret-1234567890', sessionId, nowMs });
    const forgedSignature = forged.split('.')[2];
    for (const bad of [null, undefined, '', 'a.b', `${nonce}.${exp}`, `${nonce}.${exp}.${forgedSignature}`, token.replace('.', '')]) {
      assert.equal(verifyCsrfToken(bad, { secret, sessionId, nowMs }).ok, false, `ورودی: ${String(bad)}`);
    }
  });

  test('توکن منقضی رد می‌شود', () => {
    const token = issueCsrfToken({ secret, sessionId, nowMs, ttlMs: 60_000 });
    assert.equal(verifyCsrfToken(token, { secret, sessionId, nowMs: nowMs + 59_000 }).ok, true);
    const result = verifyCsrfToken(token, { secret, sessionId, nowMs: nowMs + 61_000 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'expired');
  });

  test('درخواست تغییردهنده بدون مبدأ رد می‌شود', () => {
    const allowed = ['https://petavu.ir', 'https://panel.petavu.ir'];
    assert.equal(checkRequestOrigin({ method: 'POST', allowedOrigins: allowed }).ok, false);
    assert.equal(checkRequestOrigin({ method: 'POST', allowedOrigins: allowed }).reason, 'origin_missing');
    assert.equal(checkRequestOrigin({ method: 'POST', origin: 'https://evil.example', allowedOrigins: allowed }).ok, false);
    assert.equal(checkRequestOrigin({ method: 'POST', origin: 'https://petavu.ir', allowedOrigins: allowed }).ok, true);
  });

  test('GET نیازی به بررسی مبدأ ندارد؛ وب‌هوکِ امضاشده معاف است', () => {
    assert.equal(checkRequestOrigin({ method: 'GET', allowedOrigins: [] }).reason, 'not_required');
    assert.equal(checkRequestOrigin({ method: 'POST', allowedOrigins: [], exempt: true }).reason, 'not_required');
  });

  test('اگر Origin نبود، Referer بررسی می‌شود', () => {
    const allowed = ['https://petavu.ir'];
    assert.equal(checkRequestOrigin({ method: 'POST', referer: 'https://petavu.ir/panel/b/new', allowedOrigins: allowed }).ok, true);
    assert.equal(checkRequestOrigin({ method: 'POST', referer: 'https://evil.example/x', allowedOrigins: allowed }).ok, false);
    assert.equal(checkRequestOrigin({ method: 'POST', referer: 'not a url', allowedOrigins: allowed }).reason, 'origin_invalid');
  });

  test('پورت و پروتکل هم بخشی از مبدأ‌اند', () => {
    const allowed = ['https://panel.petavu.ir'];
    assert.equal(checkRequestOrigin({ method: 'POST', origin: 'https://panel.petavu.ir:8443', allowedOrigins: allowed }).ok, false);
    assert.equal(checkRequestOrigin({ method: 'POST', origin: 'http://panel.petavu.ir', allowedOrigins: allowed }).ok, false);
    assert.equal(safeOriginOf('https://petavu.ir/a/b?c=1'), 'https://petavu.ir');
    assert.equal(safeOriginOf('javascript:alert(1)'), 'null');
  });
});

describe('محدودیت نرخ (§13)', () => {
  test('پنجرهٔ لغزان: سقف در پنجرهٔ جاری اعمال می‌شود', async () => {
    const store = new MemoryRateLimitStore();
    const clock = { now: 0 };
    const limiter = new RateLimiter({ store, now: () => clock.now });
    const rule = { name: 'test', limit: 3, windowMs: 1_000 };

    assert.equal((await limiter.consume('k', rule)).allowed, true);
    assert.equal((await limiter.consume('k', rule)).allowed, true);
    const third = await limiter.consume('k', rule);
    assert.equal(third.allowed, true);
    assert.equal(third.remaining, 0);

    const fourth = await limiter.consume('k', rule);
    assert.equal(fourth.allowed, false);
    assert.ok(fourth.retryAfterSeconds >= 1);
  });

  test('پنجرهٔ لغزان، نه پرشِ دوبرابر روی لبهٔ پنجره', async () => {
    const store = new MemoryRateLimitStore();
    const clock = { now: 0 };
    const limiter = new RateLimiter({ store, now: () => clock.now });
    const rule = { name: 'test', limit: 4, windowMs: 1_000 };

    for (let i = 0; i < 4; i += 1) assert.equal((await limiter.consume('k', rule)).allowed, true);

    clock.now = 1_000; // ابتدای پنجرهٔ بعد: پنجرهٔ قبلی کامل وزن دارد
    assert.equal((await limiter.consume('k', rule)).allowed, false);

    clock.now = 1_500; // نیمهٔ پنجره: وزن ۰٫۵ → دو درخواست مجاز
    assert.equal((await limiter.consume('k', rule)).allowed, true);
    assert.equal((await limiter.consume('k', rule)).allowed, true);

    clock.now = 2_100; // پنجرهٔ اول کاملاً خارج شد
    assert.equal((await limiter.consume('k', rule)).allowed, true);
  });

  test('کلیدهای مختلف سقف جداگانه دارند', async () => {
    const limiter = new RateLimiter({ store: new MemoryRateLimitStore(), now: () => 0 });
    const rule = { name: 'test', limit: 1, windowMs: 1_000 };
    assert.equal((await limiter.consume('a', rule)).allowed, true);
    assert.equal((await limiter.consume('a', rule)).allowed, false);
    assert.equal((await limiter.consume('b', rule)).allowed, true);
  });

  test('peek وضعیت را تغییر نمی‌دهد', async () => {
    const limiter = new RateLimiter({ store: new MemoryRateLimitStore(), now: () => 0 });
    const rule = { name: 'test', limit: 2, windowMs: 1_000 };
    assert.equal((await limiter.peek('k', rule)).remaining, 1, 'یک درخواست دیگر تا سقف می‌ماند');
    await limiter.consume('k', rule);
    assert.equal((await limiter.peek('k', rule)).remaining, 0);
  });

  test('چند قاعده با هم: سخت‌گیرانه‌ترین برنده است', async () => {
    const limiter = new RateLimiter({ store: new MemoryRateLimitStore(), now: () => 0 });
    const account = { name: 'acct', limit: 2, windowMs: 60_000 };
    const ip = { name: 'ip', limit: 1, windowMs: 60_000 };
    const rules = [account, ip];

    const first = await limiter.consumeAll((rule) => `${rule.name}:k`, rules);
    assert.equal(first.allowed, true);
    const second = await limiter.consumeAll((rule) => `${rule.name}:k`, rules);
    assert.equal(second.allowed, false);
    assert.equal(second.rule, 'ip', 'قاعدهٔ تنگ‌تر باید گزارش شود');
  });

  test('ذخیره‌گاه حافظه، خانه‌تکانی می‌کند تا بی‌نهایت رشد نکند', async () => {
    const store = new MemoryRateLimitStore({ maxKeys: 100 });
    for (let i = 0; i < 500; i += 1) await store.hit(`key-${i}`, 1_000, i * 2_000);
    assert.ok(store.size() <= 100, `اندازهٔ ذخیره‌گاه: ${store.size()}`);
  });

  test('ضریب ریسک، سقف را تنگ می‌کند ولی صفر نمی‌کند', () => {
    assert.equal(riskFactor({}), 1);
    assert.equal(riskFactor({ flaggedIp: true }), 4);
    assert.equal(riskFactor({ flaggedIp: true, newDevice: true }), 8);
    assert.ok(riskFactor({ flaggedIp: true, newDevice: true, unusualVelocity: true, recentFailures: 9 }) <= 16);
    assert.equal(riskAdjusted(RATE_LIMITS.loginAccount, 4).limit, 2);
    assert.ok(riskAdjusted(RATE_LIMITS.publicForm, 16).limit >= 1, 'سقف هرگز صفر نمی‌شود');
  });

  test('کلید محدودیت، شناسهٔ شخصی را خام حمل نمی‌کند', () => {
    const key = limitKeys.account('login', '+989120000000');
    assert.equal(key.includes('989120000000'), false);
    assert.ok(key.startsWith('login:acct:'));
    assert.equal(limitKeys.ip('login', '203.0.113.9'), 'login:ip:203.0.113.9');
    assert.equal(limitKeys.account('login', '+989120000000'), limitKeys.account('login', '+98 912 000 0000'));
  });

  test('هدرهای پاسخ محدودیت نرخ کامل‌اند', async () => {
    const limiter = new RateLimiter({ store: new MemoryRateLimitStore(), now: () => 0 });
    const rule = { name: 'test', limit: 1, windowMs: 60_000 };
    const allowed = await limiter.consume('k', rule);
    const headers = rateLimitHeaders(allowed);
    assert.equal(headers['RateLimit-Limit'], '1');
    assert.equal(headers['RateLimit-Remaining'], '0');
    assert.equal(headers['Retry-After'], undefined);

    const denied = await limiter.consume('k', rule);
    const deniedHeaders = rateLimitHeaders(denied);
    assert.ok(Number(deniedHeaders['Retry-After']) >= 1);
  });

  test('قاعده‌های استاندارد، منطقی و دارای نام یکتا‌اند', () => {
    const names = Object.values(RATE_LIMITS).map((rule) => rule.name);
    assert.equal(new Set(names).size, names.length, 'نام قاعده‌ها باید یکتا باشد');
    for (const rule of Object.values(RATE_LIMITS)) {
      assert.ok(rule.limit >= 1, rule.name);
      assert.ok(rule.windowMs >= 1_000, rule.name);
    }
    assert.ok(RATE_LIMITS.loginAccount.limit < RATE_LIMITS.loginIp.limit, 'قاعدهٔ حساب باید تنگ‌تر از IP باشد');
  });
});
