/**
 * کلاینت API برای پنل‌ها (گام ۲۸؛ §15، §64–۷۸، §191).
 *
 * پنل **مشتریِ API** است، نه دومین سیستم: هیچ منطق کسب‌وکار، هیچ مجوزدهی و هیچ دسترسی مستقیم به پایگاه‌داده
 * در پنل نیست (§191: «هیچ Business Logic در کلاینت»؛ «هیچ امنیتی فقط در فرانت‌اند»). هر خواندن و هر تغییر از
 * همین مسیر می‌گذرد و API (احراز، مجوز، CSRF، محدودیت نرخ، RLS) تصمیم می‌گیرد. پنل فقط صفحه می‌سازد.
 *
 * هدرها فهرست سفیدند و **ما** می‌گذاریمشان: IP از سوکت (نه از ادعای کلاینت)، `Origin` همان مبدأ سایت (که
 * پیش‌تر خودمان سخت‌گیرانه سنجیدیم)، کسب‌وکار از نشست (نه از فرم).
 */

import { request as httpRequest } from 'node:http';

import type { Logger } from '@petavu/shared';

export type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ApiCall {
  readonly method: ApiMethod;
  readonly path: string;
  readonly cookie?: string | null;
  readonly csrf?: string | null;
  readonly businessId?: string | null;
  readonly body?: unknown;
  readonly origin: string;
  readonly ip: string;
  readonly requestId: string;
  readonly userAgent?: string | null;
}

export interface ApiResponse {
  readonly status: number;
  /** بدنهٔ JSON (یا `null` اگر JSON نبود). */
  readonly json: Record<string, unknown> | null;
  /** مقدارهای `Set-Cookie` پاسخ، خام. */
  readonly cookies: readonly string[];
}

export interface ApiClient {
  call(input: ApiCall): Promise<ApiResponse>;
}

/** خطای زیرساخت (API در دسترس نیست)؛ با خطای منطقی (۴xx) فرق دارد و صفحهٔ ۵۰۲ می‌گیرد. */
export class ApiUnavailableError extends Error {
  constructor() {
    super('api_unavailable');
  }
}

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export function createApiClient(options: { origin: string; logger: Logger; timeoutMs?: number }): ApiClient {
  const upstream = new URL(options.origin);

  return {
    call(input) {
      const payload = input.body === undefined ? null : Buffer.from(JSON.stringify(input.body), 'utf8');
      const headers: Record<string, string> = {
        accept: 'application/json',
        origin: input.origin,
        'x-forwarded-for': input.ip,
        'x-request-id': input.requestId,
      };
      if (payload) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = String(payload.byteLength);
      }
      if (input.cookie) headers.cookie = input.cookie;
      if (input.csrf) headers['x-csrf-token'] = input.csrf;
      if (input.businessId) headers['x-business-id'] = input.businessId;
      if (input.userAgent) headers['user-agent'] = input.userAgent.slice(0, 300);

      return new Promise<ApiResponse>((resolve, reject) => {
        const request = httpRequest(
          {
            protocol: upstream.protocol,
            hostname: upstream.hostname,
            port: upstream.port,
            path: input.path,
            method: input.method,
            headers,
            timeout: options.timeoutMs ?? 8_000,
          },
          (response) => {
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => {
              size += chunk.byteLength;
              if (size > MAX_RESPONSE_BYTES) {
                request.destroy();
                return;
              }
              chunks.push(chunk);
            });
            response.on('error', () => reject(new ApiUnavailableError()));
            response.on('end', () => {
              let json: Record<string, unknown> | null = null;
              const text = Buffer.concat(chunks).toString('utf8');
              if (text !== '' && /json/.test(String(response.headers['content-type'] ?? ''))) {
                try {
                  const parsed: unknown = JSON.parse(text);
                  json = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
                } catch {
                  json = null;
                }
              }
              const cookies = response.headers['set-cookie'];
              resolve({ status: response.statusCode ?? 502, json, cookies: Array.isArray(cookies) ? cookies : [] });
            });
          },
        );
        request.on('timeout', () => {
          request.destroy();
          options.logger.warn('API پاسخ نداد', { path: input.path });
          reject(new ApiUnavailableError());
        });
        request.on('error', () => reject(new ApiUnavailableError()));
        if (payload) request.write(payload);
        request.end();
      });
    },
  };
}
