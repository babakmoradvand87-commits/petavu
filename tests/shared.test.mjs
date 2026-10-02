/**
 * تست‌های `@petavu/shared`.
 *
 * قاعده: هر تست از خروجی ساخته‌شده (dist) استفاده می‌کند، نه از منبع. اگر
 * ساخت بشکند، تست‌ها هم می‌شکنند — همان چیزی که در استقرار رخ می‌دهد.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const PRODUCTION_ENV = {
  PETAVU_ENV: 'production',
  PETAVU_PUBLIC_ORIGIN: 'https://petavu.ir',
  PETAVU_PANEL_ORIGIN: 'https://panel.petavu.ir',
  PETAVU_ADMIN_ORIGIN: 'https://adminpanel.petavu.ir',
  PETAVU_SHOP_ORIGIN: 'https://shop.petavu.ir',
  PETAVU_ADMIN_SHOP_ORIGIN: 'https://adminshop.petavu.ir',
  SESSION_SECRET: 'a'.repeat(48),
  AUTH_PEPPER: 'b'.repeat(48),
};

import {
  AppError,
  ERROR_CODES,
  errorPayload,
  isAppError,
  toAppError,
  loadEnv,
  EnvError,
  publicUrl,
  allowedOrigins,
  uuidv7,
  isUuid,
  uuidv7Time,
  assertUuid,
  slugify,
  uniqueSlug,
  isReservedSlug,
  safeEqual,
  newOpaqueToken,
  fixedClock,
  addDuration,
  isExpired,
  MINUTE,
  HOUR,
  createLogger,
  withLogContext,
  currentLogContext,
  normalizePersian,
  foldVowels,
  foldForCompare,
  searchKey,
  detectDirection,
  displayLength,
  truncate,
  displayNameSchema,
  slugSchema,
} from '../packages/shared/dist/index.js';

describe('خطاهای ساختاریافته (§65)', () => {
  test('هر کد خطا، وضعیت HTTP درست دارد', () => {
    assert.equal(ERROR_CODES.unauthenticated, 401);
    assert.equal(ERROR_CODES.forbidden, 403);
    assert.equal(ERROR_CODES.not_found, 404);
    assert.equal(ERROR_CODES.conflict, 409);
    assert.equal(ERROR_CODES.rate_limited, 429);
    assert.equal(ERROR_CODES.internal_error, 500);
  });

  test('خطای دامنه، کد و وضعیت خودش را حمل می‌کند', () => {
    const error = new AppError('forbidden');
    assert.equal(error.status, 403);
    assert.equal(error.code, 'forbidden');
    assert.equal(error.retryable, false);
    assert.ok(isAppError(error));
  });

  test('فقط خطاهای گذرا قابل تلاش دوباره‌اند', () => {
    assert.equal(new AppError('timeout').retryable, true);
    assert.equal(new AppError('service_unavailable').retryable, true);
    assert.equal(new AppError('conflict').retryable, false);
    assert.equal(new AppError('validation_failed').retryable, false);
  });

  test('خطای ناشناخته به internal_error تبدیل می‌شود و علت لو نمی‌رود', () => {
    const mapped = toAppError(new Error('اتصال به 10.0.0.5:5432 رد شد'));
    assert.equal(mapped.code, 'internal_error');
    const payload = errorPayload(mapped, 'req_1');
    assert.equal(payload.error.message.includes('10.0.0.5'), false);
    assert.equal(JSON.stringify(payload).includes('10.0.0.5'), false);
  });

  test('خطای zod به validation_failed با مسیر فیلدها نگاشت می‌شود', () => {
    const zodLike = Object.assign(new Error('invalid'), {
      name: 'ZodError',
      issues: [{ path: ['email'], code: 'invalid_format' }],
    });
    const mapped = toAppError(zodLike);
    assert.equal(mapped.code, 'validation_failed');
    assert.deepEqual(mapped.details, { issues: [{ path: 'email', code: 'invalid_format' }] });
  });

  test('کدهای PostgreSQL به خطای دامنه ترجمه می‌شوند', () => {
    assert.equal(toAppError({ code: '23505' }).code, 'conflict');
    assert.equal(toAppError({ code: '23503' }).code, 'validation_failed');
    assert.equal(toAppError({ code: '40001' }).code, 'conflict');
    assert.equal(toAppError({ code: '57014' }).code, 'timeout');
    assert.equal(toAppError({ code: '42501' }).code, 'forbidden');
  });

  test('پیام خطا فارسی و بدون اصطلاح داخلی است', () => {
    for (const code of Object.keys(ERROR_CODES)) {
      const message = new AppError(code).message;
      assert.ok(message.length > 3, `پیام ${code} خالی است`);
      assert.equal(/[A-Za-z]{4,}/.test(message), false, `پیام ${code} واژهٔ لاتین دارد: ${message}`);
    }
  });

  test('پاسخ خطا همیشه request_id دارد', () => {
    const payload = errorPayload(new AppError('not_found'), 'req_abc');
    assert.equal(payload.error.request_id, 'req_abc');
    assert.equal(payload.error.code, 'not_found');
  });
});

describe('پیکربندی محیط (§75، §80–۸۲)', () => {
  test('مقادیر پیش‌فرض برای توسعه کافی‌اند', () => {
    const env = loadEnv({});
    assert.equal(env.env, 'development');
    assert.equal(env.isDevelopment, true);
    assert.equal(env.database.embedded, true);
    assert.equal(env.origins.public, 'http://localhost:3000');
    assert.equal(env.search.driver, 'postgres');
    assert.equal(env.email.configured, false);
  });

  test('production بدون رازهای نشست بالا نمی‌آید', () => {
    assert.throws(
      () => loadEnv({ PETAVU_ENV: 'production', PETAVU_PUBLIC_ORIGIN: 'https://petavu.ir' }),
      (error) => error instanceof EnvError && error.message.includes('SESSION_SECRET'),
    );
  });

  test('production با راز کوتاه رد می‌شود', () => {
    assert.throws(
      () =>
        loadEnv({
          PETAVU_ENV: 'production',
          PETAVU_PUBLIC_ORIGIN: 'https://petavu.ir',
          SESSION_SECRET: 'کوتاه',
          AUTH_PEPPER: 'x'.repeat(64),
        }),
      (error) => error instanceof EnvError && error.message.includes('۳۲'),
    );
  });

  test('production با https و راز کافی بالا می‌آید', () => {
    const env = loadEnv(PRODUCTION_ENV);
    assert.equal(env.isProduction, true);
    assert.equal(env.origins.public, 'https://petavu.ir');
    assert.equal(env.origins.adminShop, 'https://adminshop.petavu.ir');
  });

  test('production اگر یکی از چهار سطح http بماند، بالا نمی‌آید', () => {
    const broken = { ...PRODUCTION_ENV, PETAVU_SHOP_ORIGIN: 'http://shop.petavu.ir' };
    assert.throws(() => loadEnv(broken), (error) => error instanceof EnvError && error.message.includes('PETAVU_SHOP_ORIGIN'));
  });

  test('production با http رد می‌شود', () => {
    assert.throws(
      () =>
        loadEnv({
          PETAVU_ENV: 'production',
          PETAVU_PUBLIC_ORIGIN: 'http://petavu.ir',
          SESSION_SECRET: 'a'.repeat(48),
          AUTH_PEPPER: 'b'.repeat(48),
        }),
      (error) => error instanceof EnvError && error.message.includes('https'),
    );
  });

  test('نشانی با مسیر یا پارامتر پذیرفته نمی‌شود', () => {
    assert.throws(() => loadEnv({ PETAVU_PUBLIC_ORIGIN: 'https://petavu.ir/fa' }), EnvError);
    assert.throws(() => loadEnv({ PETAVU_PANEL_ORIGIN: 'https://panel.petavu.ir/?x=1' }), EnvError);
    assert.throws(() => loadEnv({ PETAVU_SHOP_ORIGIN: 'not-a-url' }), EnvError);
  });

  test('آدرس مطلق از پیکربندی ساخته می‌شود، نه از درخواست', () => {
    const env = loadEnv({ PETAVU_PUBLIC_ORIGIN: 'https://petavu.ir' });
    assert.equal(publicUrl(env), 'https://petavu.ir/');
    assert.equal(publicUrl(env, '/b/tak-pet'), 'https://petavu.ir/b/tak-pet');
    assert.deepEqual(allowedOrigins(env).length, 5);
  });

  test('چهار سطح مستقل، هرکدام دامنهٔ خودش', () => {
    const env = loadEnv({
      PETAVU_PUBLIC_ORIGIN: 'https://petavu.ir',
      PETAVU_PANEL_ORIGIN: 'https://panel.petavu.ir',
      PETAVU_ADMIN_ORIGIN: 'https://adminpanel.petavu.ir',
      PETAVU_SHOP_ORIGIN: 'https://shop.petavu.ir',
      PETAVU_ADMIN_SHOP_ORIGIN: 'https://adminshop.petavu.ir',
    });
    const origins = allowedOrigins(env);
    assert.equal(new Set(origins).size, 5);
  });

  test('سقف اتصال و مهلت پرس‌وجو عددی و محدودند', () => {
    assert.equal(loadEnv({ DATABASE_POOL_MAX: '25' }).database.poolMax, 25);
    assert.throws(() => loadEnv({ DATABASE_POOL_MAX: '0' }), EnvError);
    assert.throws(() => loadEnv({ DATABASE_STATEMENT_TIMEOUT_MS: '10' }), EnvError);
  });
});

describe('شناسه‌ها (§7)', () => {
  test('UUIDv7 معتبر است و بیت نسخهٔ ۷ دارد', () => {
    const id = uuidv7();
    assert.ok(isUuid(id));
    assert.equal(id[14], '7');
  });

  test('UUIDv7 با زمان مرتب‌شونده است', () => {
    const base = 1_800_000_000_000;
    const first = uuidv7(base);
    const second = uuidv7(base + 1);
    const third = uuidv7(base + 1_000);
    assert.ok(first < second, 'شناسهٔ قدیمی‌تر باید کوچک‌تر باشد');
    assert.ok(second < third);
    assert.equal(uuidv7Time(first), base);
  });

  test('۱۰٬۰۰۰ شناسه در یک میلی‌ثانیه یکتا و بدون برخورد‌اند', () => {
    const now = Date.now();
    const ids = new Set();
    for (let i = 0; i < 10_000; i += 1) ids.add(uuidv7(now));
    assert.equal(ids.size, 10_000);
  });

  test('ورودی نامعتبر رد می‌شود، نه اینکه به پایگاه‌داده برود', () => {
    assert.equal(isUuid('1'), false);
    assert.equal(isUuid("1' OR 1=1--"), false);
    assert.equal(isUuid(null), false);
    assert.throws(() => assertUuid('abc', 'شناسهٔ کسب‌وکار'), TypeError);
    assert.equal(assertUuid('018F2C6E-7A1B-7C3D-8E4F-5A6B7C8D9E0F'), '018f2c6e-7a1b-7c3d-8e4f-5a6b7c8d9e0f');
  });

  test('توکن مبهم، غیرقابل حدس و بلند است', () => {
    const token = newOpaqueToken();
    assert.ok(token.length >= 43, 'باید حداقل ۳۲ بایت آنتروپی باشد');
    assert.notEqual(token, newOpaqueToken());
    assert.equal(/[+/=]/.test(token), false, 'باید امن برای URL باشد');
  });

  test('نامک فارسی می‌سازد و نامک ممنوع رد می‌شود', () => {
    assert.equal(slugify('پت‌آوو'), 'پت-آوو');
    assert.equal(slugify('  Tak Pet  '), 'tak-pet');
    assert.equal(slugify('کلینیک دامپزشکی ۲۴'), 'کلینیک-دامپزشکی-24');
    assert.equal(slugify('!!!'), '');
    assert.equal(isReservedSlug('admin'), true);
    assert.equal(isReservedSlug('tak-pet'), false);
    assert.throws(() => uniqueSlug('api', () => false), TypeError);
  });

  test('نامک تکراری پسوند می‌خورد و نامک موجود بازنویسی نمی‌شود', () => {
    const taken = new Set(['tak-pet']);
    const slug = uniqueSlug('tak pet', (candidate) => taken.has(candidate));
    assert.match(slug, /^tak-pet-\d{4}$/);
  });

  test('مقایسهٔ راز، ثابت‌زمان و درست است', () => {
    assert.equal(safeEqual('token-abc', 'token-abc'), true);
    assert.equal(safeEqual('token-abc', 'token-abd'), false);
    assert.equal(safeEqual('token-abc', 'token-abc-longer'), false);
    assert.equal(safeEqual('', ''), true);
  });
});

describe('زمان (§20)', () => {
  test('ساعت دستی جلو می‌رود و انقضا را درست می‌سنجد', () => {
    const clock = fixedClock(Date.parse('2026-01-01T00:00:00.000Z'));
    const expires = addDuration(clock, 15 * MINUTE);
    assert.equal(expires.toISOString(), '2026-01-01T00:15:00.000Z');
    assert.equal(isExpired(clock, expires), false);
    clock.advance(15 * MINUTE + 1);
    assert.equal(isExpired(clock, expires), true);
  });

  test('انقضای رشتهٔ ISO هم پشتیبانی می‌شود', () => {
    const clock = fixedClock(Date.parse('2026-01-01T00:00:00.000Z'));
    assert.equal(isExpired(clock, '2025-12-31T23:59:59.000Z'), true);
    assert.equal(isExpired(clock, '2026-01-01T01:00:00.000Z'), false);
    assert.equal(isExpired(clock, new Date(clock.now() + HOUR)), false);
  });
});

describe('لاگ ساختاریافته (§96)', () => {
  test('هر خط JSON است با level، time و msg', () => {
    const records = [];
    const logger = createLogger({ level: 'debug', sink: (record) => records.push(record) });
    logger.info('کسب‌وکار ساخته شد', { business_id: 'bz_1' });
    assert.equal(records.length, 1);
    assert.equal(records[0].level, 'info');
    assert.equal(records[0].msg, 'کسب‌وکار ساخته شد');
    assert.equal(records[0].business_id, 'bz_1');
    assert.ok(!Number.isNaN(Date.parse(records[0].time)));
    assert.doesNotThrow(() => JSON.stringify(records[0]));
  });

  test('رمز، توکن و کوکی هرگز لاگ نمی‌شوند', () => {
    const records = [];
    const logger = createLogger({ level: 'debug', sink: (record) => records.push(record) });
    logger.info('تلاش ورود', {
      phone: '+989120000000',
      password: 'Sup3rSecret!',
      token: 'eyJhbGciOi',
      cookie: 'pv_session=abc',
      service_role_key: 'sb_secret_xyz',
      nested: { refresh_token: 'rt_1', safe: 'ok' },
    });
    const serialized = JSON.stringify(records);
    assert.equal(serialized.includes('Sup3rSecret!'), false);
    assert.equal(serialized.includes('eyJhbGciOi'), false);
    assert.equal(serialized.includes('pv_session=abc'), false);
    assert.equal(serialized.includes('sb_secret_xyz'), false);
    assert.equal(serialized.includes('rt_1'), false);
    assert.equal(serialized.includes('[حذف‌شده]'), true);
    assert.equal(records[0].phone, '+989120000000');
    assert.equal(records[0].nested.safe, 'ok');
  });

  test('سطح لاگ فیلتر می‌کند', () => {
    const records = [];
    const logger = createLogger({ level: 'warn', sink: (record) => records.push(record) });
    logger.debug('تفصیلی');
    logger.info('عادی');
    logger.warn('هشدار');
    logger.error('خطا');
    assert.deepEqual(records.map((record) => record.level), ['warn', 'error']);
  });

  test('request_id از بافت جاری به همهٔ لاگ‌ها می‌رسد', () => {
    const records = [];
    const logger = createLogger({ level: 'debug', sink: (record) => records.push(record) });
    withLogContext({ requestId: 'req_42', businessId: 'bz_9' }, () => {
      assert.equal(currentLogContext().requestId, 'req_42');
      logger.info('شروع پردازش');
      logger.child({ jobId: 'job_7' }).info('کار صف');
    });
    assert.equal(records[0].request_id, 'req_42');
    assert.equal(records[0].business_id, 'bz_9');
    assert.equal(records[1].job_id, 'job_7');
    assert.equal(records[1].request_id, 'req_42');
    assert.equal(currentLogContext().requestId, undefined);
  });

  test('خطا در لاگ، بدون پشتهٔ خطا ثبت می‌شود', () => {
    const records = [];
    const logger = createLogger({ level: 'debug', sink: (record) => records.push(record) });
    logger.error('شکست پرس‌وجو', { error: new Error('boom'), db_code: '42P01' });
    assert.equal(records[0].error.name, 'Error');
    assert.equal(records[0].error.message, 'boom');
    assert.equal(records[0].error.stack, undefined);
  });
});

describe('متن فارسی (§45–47)', () => {
  test('حروف عربی به فارسی یکسان‌سازی می‌شوند، بدون تغییر شکل نمایشی', () => {
    assert.equal(normalizePersian('كتاب'), 'کتاب');
    assert.equal(normalizePersian('يك'), 'یک');
    assert.equal(normalizePersian('مدرسة'), 'مدرسه');
    // «آ» یک نویسهٔ فارسی معتبر است؛ در نمایش دست‌نخورده می‌ماند.
    assert.equal(normalizePersian('پت‌آوو'), 'پت‌آوو');
    // و فقط در مقایسه تا می‌شود.
    // نیم‌فاصله در «تا کردن» به فاصله تبدیل می‌شود، پس برای برابری کامل از
    // کلید جست‌وجو استفاده می‌کنیم که فاصله‌ها را هم حذف می‌کند.
    assert.equal(searchKey('پت‌آوو'), searchKey('پتاوو'));
    assert.equal(foldForCompare('پت‌آوو'), 'پت اوو');
    assert.equal(foldForCompare('أحمد'), foldForCompare('احمد'));
    assert.equal(searchKey('آموزش'), searchKey('اموزش'));
  });

  test('اعداد فارسی و عربی به لاتین تبدیل می‌شوند', () => {
    assert.equal(normalizePersian('۱۲۳۴'), '1234');
    assert.equal(normalizePersian('٥٦٧'), '567');
  });

  test('واکه‌های همزه‌دار فقط در مقایسه تا می‌شوند', () => {
    assert.equal(foldVowels('پت‌آوو'), 'پت‌اوو');
    assert.equal(foldVowels('کشـــور'), 'کشور');
  });

  test('نشانه‌های کنترلی جهت حذف می‌شوند', () => {
    assert.equal(normalizePersian('پت\u200f\u202bآوو'), 'پتآوو');
  });

  test('نیم‌فاصله در نمایش می‌ماند و در مقایسه یکسان می‌شود', () => {
    const text = 'می‌رود';
    assert.ok(text.includes('\u200c'));
    assert.equal(normalizePersian(text), 'می‌رود');
    assert.equal(foldForCompare('می‌رود'), 'می رود');
    assert.equal(searchKey('می‌رود'), searchKey('میرود'));
    assert.equal(searchKey('می رود'), searchKey('میرود'));
  });

  test('جهت متن از محتوا تشخیص داده می‌شود', () => {
    assert.equal(detectDirection('کلینیک دامپزشکی'), 'rtl');
    assert.equal(detectDirection('Tak Pet Clinic'), 'ltr');
    assert.equal(detectDirection('PETAVU'), 'ltr');
    assert.equal(detectDirection('۲۴'), 'rtl', 'بدون حرف، جهت پیش‌فرض می‌ماند');
    // در متن مختلط، اکثریت حروف تعیین می‌کند — نام لاتین در صفحهٔ فارسی نباید
    // جهت کل عنصر را برگرداند.
    assert.equal(detectDirection('Petavu پت‌آوو'), 'ltr');
    assert.equal(detectDirection('کلینیک Petavu در تهران'), 'rtl');
  });

  test('طول نمایشی نیم‌فاصله را نیم‌وزن می‌شمارد', () => {
    assert.equal(displayLength('میرود'), 5);
    assert.equal(displayLength('می‌رود'), 5.5);
  });

  test('برش متن فارسی واژه را نصف نمی‌کند و طول را نگه می‌دارد', () => {
    const text = 'کلینیک دامپزشکی تخصصی حیوانات خانگی در تهران';
    const cut = truncate(text, 20);
    assert.ok(displayLength(cut) <= 20);
    assert.ok(cut.endsWith('…'));
    assert.equal(truncate('کوتاه', 20), 'کوتاه');
  });

  test('نام نمایشی فارسی پذیرفته و متن انگلیسی رد نمی‌شود اما امنیت حفظ می‌شود', () => {
    assert.equal(displayNameSchema.parse('کلینیک پت آوو'), 'کلینیک پت آوو');
    assert.equal(displayNameSchema.safeParse(' ').success, false);
    assert.equal(displayNameSchema.safeParse('ا').success, false);
    assert.equal(displayNameSchema.safeParse('x'.repeat(121)).success, false);
  });

  test('نامک فارسی و لاتین پذیرفته می‌شود اما کاراکترهای خطرناک نه', () => {
    assert.equal(slugSchema.safeParse('کلینیک-پت').success, true);
    assert.equal(slugSchema.safeParse('tak-pet-24').success, true);
    assert.equal(slugSchema.safeParse('Tak-Pet').success, false);
    assert.equal(slugSchema.safeParse('a/../b').success, false);
    assert.equal(slugSchema.safeParse('-start').success, false);
    assert.equal(slugSchema.safeParse('a b').success, false);
  });
});
