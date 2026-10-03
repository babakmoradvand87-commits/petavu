/**
 * تولید سند OpenAPI از فهرست مسیرها (گام ۲۱؛ §66).
 *
 * سند، **تولیدشده** است نه نوشته‌شده: اگر دستی نوشته شود، اولین تغییری که در
 * مسیرها بدهیم، سند را دروغگو می‌کند و سند دروغگو بدتر از سند نبودن است.
 *
 * سند به‌علاوهٔ مسیرها، دو چیز دیگر را هم مستند می‌کند که در بازبینی امنیتی
 * مهم‌اند: **الگوی احراز هویت** و **مجوز لازم** برای هر عملیات. هر دو از خود
 * تعریف مسیر خوانده می‌شوند، پس امکان واگرایی ندارند.
 */

import type { RouteDefinition } from './types.js';
import { API_PREFIX } from './routes/index.js';

export interface OpenApiOptions {
  readonly title?: string;
  readonly version?: string;
  readonly publicOrigin: string;
}

export function buildOpenApi(routes: readonly RouteDefinition[], options: OpenApiOptions): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags = new Set<string>();

  for (const route of routes) {
    for (const tag of route.tags) tags.add(tag);

    const openApiPath = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const parameters = [...openApiPath.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => ({
      name: match[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    const method = route.method.toLowerCase();
    paths[openApiPath] = paths[openApiPath] ?? {};
    (paths[openApiPath] as Record<string, unknown>)[method] = {
      operationId: route.name,
      summary: route.summary,
      tags: [...route.tags],
      security: securityFor(route),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(route.rateLimit
        ? { 'x-rate-limit': { rule: route.rateLimit.name, limit: route.rateLimit.limit, window_ms: route.rateLimit.windowMs } }
        : {}),
      ...(route.permission ? { 'x-permission': route.permission } : {}),
      ...(route.platformPermission ? { 'x-platform-permission': route.platformPermission } : {}),
      'x-database-role': route.role,
      ...(['POST', 'PATCH', 'PUT'].includes(route.method)
        ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } } }
        : {}),
      responses: {
        [route.method === 'POST' ? '201' : '200']: { description: 'پاسخ موفق' },
        '400': { $ref: '#/components/responses/Error' },
        '401': { $ref: '#/components/responses/Error' },
        '403': { $ref: '#/components/responses/Error' },
        '404': { $ref: '#/components/responses/Error' },
        '429': { $ref: '#/components/responses/Error' },
        '500': { $ref: '#/components/responses/Error' },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.title ?? 'PETAVU API',
      version: options.version ?? '1.0.0',
      description:
        'نقاط پایانی نسخهٔ یکم. همهٔ پاسخ‌های خطا یک شکل دارند: `code`, `message`, `details`, `request_id`.',
    },
    servers: [{ url: options.publicOrigin, description: 'دامنهٔ عمومی' }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'pv_session',
          description: 'کوکی نشست، HttpOnly و بی‌دامنه؛ همراه هدر `x-csrf-token` در درخواست‌های تغییردهنده.',
        },
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'کلید API کسب‌وکار؛ دامنهٔ مجوز، هنگام ساخت کلید تعیین می‌شود.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'request_id'],
              properties: {
                code: {
                  type: 'string',
                  enum: [
                    'validation_failed',
                    'unauthenticated',
                    'csrf_failed',
                    'forbidden',
                    'not_found',
                    'method_not_allowed',
                    'conflict',
                    'precondition_failed',
                    'payload_too_large',
                    'unsupported_media_type',
                    'rate_limited',
                    'account_locked',
                    'internal_error',
                    'service_unavailable',
                    'timeout',
                  ],
                },
                message: { type: 'string' },
                details: { type: 'object', additionalProperties: true },
                request_id: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        Error: {
          description: 'خطای ساختاریافته',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
    'x-api-prefix': API_PREFIX,
  };
}

function securityFor(route: RouteDefinition): unknown[] {
  switch (route.auth) {
    case 'session':
      return [{ sessionCookie: [] }];
    case 'api-key':
      return [{ apiKey: [] }];
    case 'any':
    case 'authenticated':
      return [{ sessionCookie: [] }, { apiKey: [] }];
    case 'public':
    default:
      return [];
  }
}
