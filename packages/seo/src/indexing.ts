/**
 * آداپتورهای ایندکس (Addendum §46–۴۷).
 *
 * قاعدهٔ Addendum §102: هیچ Mock به‌جای پیاده‌سازی. پس اینجا **پروتکل واقعی**
 * پیاده می‌شود و `fetch` تزریق می‌شود — نه برای جعل، بلکه برای اینکه آزمون
 * بتواند بدون شبکه، شکل درخواست و رفتار خطا را بسنجد. در تولید، همان `fetch`
 * جهانی می‌نشیند.
 *
 * سه تصمیم که همه از تجربهٔ عملیاتی می‌آیند:
 *
 *   ۱) **دسته‌ای فرستادن**: IndexNow سقف ۱۰٬۰۰۰ نشانی در هر درخواست دارد.
 *   ۲) **پس‌رفت نمایی با سقف**: ۴۲۹ و ۵xx موقتی‌اند؛ بی‌پس‌رفت، همان لحظه
 *      دوباره می‌زنیم و سهمیه را می‌سوزانیم.
 *   ۳) **نتیجهٔ ساختاریافته**: پاسخ به شکل `seo.indexing_event` برمی‌گردد
 *      (`channel`, `action`, `status`, `response_code`, `response_note`) تا
 *      ثبتش، تصمیم دوم نباشد.
 */

export interface IndexingRequestResult {
  channel: 'indexnow' | 'google' | 'bing' | 'yandex' | 'manual' | 'api' | 'sitemap';
  action: 'submit' | 'update' | 'delete' | 'resubmit' | 'ping' | 'status';
  status: 'queued' | 'sent' | 'accepted' | 'rejected' | 'failed' | 'throttled';
  responseCode: number | null;
  responseNote: string | null;
  urlCount: number;
  requestId: string | null;
  /** اگر تلاش دوباره لازم است، ثانیه‌ها؛ وگرنه تهی. */
  retryAfterSeconds: number | null;
  attempts: number;
}

export interface FetchLikeResponse {
  status: number;
  headers?: { get(name: string): string | null } | Record<string, string | undefined>;
  text?: () => Promise<string>;
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<FetchLikeResponse>;

export interface IndexNowOptions {
  /** کلید IndexNow؛ از ENV، هرگز در کد. */
  key: string;
  /** محل فایل کلید؛ اگر ندهید، `${baseUrl}/${key}.txt` فرض می‌شود. */
  keyLocation?: string;
  /** نقطهٔ پایانی؛ پیش‌فرض endpoint رسمی. */
  endpoint?: string;
  baseUrl: string;
  fetch?: FetchLike;
  /** سقف نشانی در هر درخواست. */
  batchSize?: number;
  /** شمار تلاش‌ها (شامل تلاش اول). */
  maxAttempts?: number;
  /** مبنای پس‌رفت نمایی، میلی‌ثانیه. */
  baseDelayMs?: number;
  /** تابع خواب؛ در تولید `setTimeout`، در آزمون بی‌اثر. */
  sleep?: (ms: number) => Promise<void>;
  clock?: { now(): number };
}

export const INDEXNOW_MAX_URLS_PER_REQUEST = 10_000;
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

function headerValue(response: FetchLikeResponse, name: string): string | null {
  const headers = response.headers;
  if (!headers) return null;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(name: string): string | null }).get(name);
  }
  const record = headers as Record<string, string | undefined>;
  const found = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
  return found ? (record[found] ?? null) : null;
}

/** نگاشت کد وضعیت به وضعیت رخداد ایندکس. */
export function mapIndexNowStatus(status: number): { status: IndexingRequestResult['status']; note: string } {
  switch (status) {
    case 200:
      return { status: 'accepted', note: 'نشانی‌ها پذیرفته شد' };
    case 202:
      return { status: 'accepted', note: 'در انتظار بررسی کلید' };
    case 400:
      return { status: 'rejected', note: 'درخواست نامعتبر' };
    case 403:
      return { status: 'rejected', note: 'کلید نامعتبر یا فایل کلید در دسترس نیست' };
    case 422:
      return { status: 'rejected', note: 'نشانی‌ها با میزبان کلید هم‌خوان نیستند' };
    case 429:
      return { status: 'throttled', note: 'محدودیت نرخ؛ بعداً تلاش شود' };
    default:
      if (status >= 500) return { status: 'failed', note: `خطای سرویس ارائه‌دهنده (${status})` };
      return { status: 'failed', note: `پاسخ ناشناخته (${status})` };
  }
}

export function chunkUrls(urls: readonly string[], size = INDEXNOW_MAX_URLS_PER_REQUEST): string[][] {
  const limit = Math.max(1, Math.min(size, INDEXNOW_MAX_URLS_PER_REQUEST));
  const chunks: string[][] = [];
  for (let index = 0; index < urls.length; index += limit) chunks.push(urls.slice(index, index + limit));
  return chunks;
}

/** فقط نشانی‌های هم‌میزان پایه؛ بقیه، خطای کلاینت است نه درخواست بی‌فایده. */
export function filterSameHost(urls: readonly string[], baseUrl: string): { accepted: string[]; rejected: string[] } {
  const host = new URL(baseUrl).hostname.replace(/^www\./, '');
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.replace(/^www\./, '') === host) accepted.push(parsed.toString());
      else rejected.push(url);
    } catch {
      rejected.push(url);
    }
  }
  return { accepted, rejected };
}

export interface IndexNowAdapter {
  /** ارسال دسته‌ای با پس‌رفت؛ خروجی، یک نتیجه به‌ازای هر دسته. */
  submit(urls: readonly string[], action?: IndexingRequestResult['action']): Promise<IndexingRequestResult[]>;
}

export function createIndexNowAdapter(options: IndexNowOptions): IndexNowAdapter {
  const endpoint = options.endpoint ?? INDEXNOW_ENDPOINT;
  const fetcher = options.fetch ?? ((globalThis.fetch as unknown as FetchLike) ?? undefined);
  const batchSize = options.batchSize ?? INDEXNOW_MAX_URLS_PER_REQUEST;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  if (!fetcher) {
    throw new Error('آداپتور IndexNow بدون تابع fetch قابل ساخت نیست (تزریق کنید یا globalThis.fetch را فراهم کنید)');
  }

  return {
    async submit(urls, action = 'submit') {
      if (urls.length === 0) return [];

      const { accepted, rejected } = filterSameHost(urls, options.baseUrl);
      const results: IndexingRequestResult[] = [];

      if (rejected.length > 0) {
        results.push({
          channel: 'indexnow',
          action,
          status: 'rejected',
          responseCode: 422,
          responseNote: 'نشانی‌ها با میزبان سایت هم‌خوان نیستند',
          urlCount: rejected.length,
          requestId: null,
          retryAfterSeconds: null,
          attempts: 0,
        });
      }

      const keyLocation = options.keyLocation ?? `${options.baseUrl.replace(/\/+$/, '')}/${options.key}.txt`;

      for (const batch of chunkUrls(accepted, batchSize)) {
        let attempts = 0;
        let last: IndexingRequestResult | null = null;

        while (attempts < maxAttempts) {
          attempts += 1;
          const body = JSON.stringify({
            host: new URL(options.baseUrl).hostname,
            key: options.key,
            keyLocation,
            urlList: batch,
          });

          try {
            const response = await fetcher(endpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json; charset=utf-8' },
              body: action === 'delete' ? JSON.stringify({ ...JSON.parse(body), action: 'delete' }) : body,
            });

            const mapped = mapIndexNowStatus(response.status);
            const retryAfterHeader = headerValue(response, 'retry-after');
            const retryAfter = mapped.status === 'throttled'
              ? Number(retryAfterHeader ?? Math.round(baseDelayMs / 1000) * attempts) || null
              : null;

            last = {
              channel: 'indexnow',
              action,
              status: mapped.status,
              responseCode: response.status,
              responseNote: mapped.note,
              urlCount: batch.length,
              requestId: headerValue(response, 'x-request-id'),
              retryAfterSeconds: retryAfter,
              attempts,
            };

            const retryable = mapped.status === 'throttled' || mapped.status === 'failed';
            if (!retryable) break;

            if (attempts < maxAttempts) {
              // پس‌رفت نمایی با سقف؛ بدون jitter تصادفی، همهٔ کارگرها هم‌زمان می‌زنند.
              const backoff = Math.min(baseDelayMs * 2 ** (attempts - 1), 30_000);
              await sleep(retryAfter ? retryAfter * 1000 : backoff);
            }
          } catch (error) {
            last = {
              channel: 'indexnow',
              action,
              status: 'failed',
              responseCode: null,
              responseNote: error instanceof Error ? `خطای شبکه: ${error.name}` : 'خطای شبکه',
              urlCount: batch.length,
              requestId: null,
              retryAfterSeconds: null,
              attempts,
            };
            if (attempts < maxAttempts) await sleep(Math.min(baseDelayMs * 2 ** (attempts - 1), 30_000));
          }
        }

        if (last) results.push(last);
      }

      return results;
    },
  };
}

export interface SitemapPingOptions {
  endpoints: readonly string[];
  fetch?: FetchLike;
  baseUrl: string;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

/**
 * اعلان سایتمپ به موتورهای جست‌وجو.
 *
 * واقعیتِ امروز: گوگل اندپوینت ping را بازنشسته کرده و تنها راه، ثبت سایتمپ در
 * Search Console است. پس این آداپتور **فهرست اندپوینت را از بیرون می‌گیرد** و
 * ۴۱۰/۴۰۴ را «پشتیبانی‌نشده» گزارش می‌کند — نه اینکه وانمود کند فرستاده شد.
 */
export function createSitemapPingAdapter(options: SitemapPingOptions) {
  const fetcher = options.fetch ?? ((globalThis.fetch as unknown as FetchLike) ?? undefined);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  if (!fetcher) throw new Error('آداپتور اعلان سایتمپ بدون fetch قابل ساخت نیست');

  return {
    async ping(sitemapPath: string): Promise<IndexingRequestResult[]> {
      const sitemapUrl = /^https?:\/\//i.test(sitemapPath) ? sitemapPath : `${options.baseUrl.replace(/\/+$/, '')}${sitemapPath}`;
      const results: IndexingRequestResult[] = [];

      for (const endpoint of options.endpoints) {
        const target = endpoint.includes('{sitemap}')
          ? endpoint.replace('{sitemap}', encodeURIComponent(sitemapUrl))
          : `${endpoint}${endpoint.includes('?') ? '&' : '?'}sitemap=${encodeURIComponent(sitemapUrl)}`;

        let attempts = 0;
        let result: IndexingRequestResult | null = null;
        while (attempts < maxAttempts) {
          attempts += 1;
          try {
            const response = await fetcher(target, { method: 'GET' });
            const supported = response.status < 400;
            result = {
              channel: 'sitemap',
              action: 'ping',
              status: supported ? 'sent' : response.status === 410 || response.status === 404 ? 'rejected' : 'failed',
              responseCode: response.status,
              responseNote: supported
                ? 'اعلان پذیرفته شد'
                : response.status === 410 || response.status === 404
                  ? 'این اندپوینت بازنشسته شده است (گوگل: ثبت در Search Console)'
                  : `پاسخ ${response.status}`,
              urlCount: 1,
              requestId: null,
              retryAfterSeconds: null,
              attempts,
            };
            if (supported) break;
          } catch (error) {
            result = {
              channel: 'sitemap',
              action: 'ping',
              status: 'failed',
              responseCode: null,
              responseNote: error instanceof Error ? `خطای شبکه: ${error.name}` : 'خطای شبکه',
              urlCount: 1,
              requestId: null,
              retryAfterSeconds: null,
              attempts,
            };
          }
          if (attempts < maxAttempts) await sleep(500 * attempts);
        }
        if (result) results.push(result);
      }

      return results;
    },
  };
}
