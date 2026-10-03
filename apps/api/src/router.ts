/**
 * مسیریاب (گام ۲۱).
 *
 * مسیریاب عمداً ساده است: درخت ایستا برای بخش‌های ثابت، و پارامتر برای
 * بخش‌های `:name`. دلیل اینکه سراغ regex یا کتابخانه نمی‌رویم این است که
 * ترتیب تطبیق باید **قابل‌پیش‌بینی** باشد: `/businesses/:id/content` و
 * `/businesses/:id` نباید به هم بریزند، و «دقیق‌ترین تطبیق برنده» باید یک
 * قاعدهٔ صریح باشد، نه نتیجهٔ ترتیب درج.
 */

import type { HttpMethod, RouteDefinition } from './types.js';

export interface RouteMatch {
  readonly route: RouteDefinition;
  readonly params: Record<string, string>;
}

export type MatchResult =
  | { readonly kind: 'match'; readonly match: RouteMatch }
  | { readonly kind: 'method_not_allowed'; readonly allowed: HttpMethod[] }
  | { readonly kind: 'not_found' };

export class Router {
  private readonly routes: RouteDefinition[] = [];

  constructor(routes: readonly RouteDefinition[]) {
    const seen = new Set<string>();
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) throw new Error(`مسیر تکراری در فهرست: ${key}`);
      seen.add(key);
      this.routes.push(route);
    }
  }

  list(): readonly RouteDefinition[] {
    return this.routes;
  }

  /** مسیرهای متناظر با یک نشانی، بی‌توجه به روش. */
  private candidates(pathname: string): Array<{ route: RouteDefinition; params: Record<string, string>; score: number }> {
    const parts = splitPath(pathname);
    const found: Array<{ route: RouteDefinition; params: Record<string, string>; score: number }> = [];

    for (const route of this.routes) {
      const routeParts = splitPath(route.path);
      if (routeParts.length !== parts.length) continue;

      const params: Record<string, string> = {};
      let staticSegments = 0;
      let matched = true;

      for (let index = 0; index < routeParts.length; index += 1) {
        const expected = routeParts[index] as string;
        const actual = parts[index] as string;
        if (expected.startsWith(':')) {
          if (actual === '') {
            matched = false;
            break;
          }
          params[expected.slice(1)] = decodeURIComponent(actual);
          continue;
        }
        if (expected !== actual) {
          matched = false;
          break;
        }
        staticSegments += 1;
      }

      if (matched) found.push({ route, params, score: staticSegments });
    }

    // «دقیق‌ترین تطبیق برنده»: مسیری با بخش‌های ثابت بیشتر، بر مسیر پارامتری
    // مقدم است. پس `/businesses/:id/content` هرگز `/businesses/:id` را
    // نمی‌دزدد و برعکسش هم پیش نمی‌آید.
    return found.sort((a, b) => b.score - a.score);
  }

  match(method: HttpMethod | 'HEAD', pathname: string): MatchResult {
    const found = this.candidates(pathname);
    if (found.length === 0) return { kind: 'not_found' };

    const exact = found.find((candidate) => candidate.route.method === method);
    if (exact) return { kind: 'match', match: { route: exact.route, params: exact.params } };

    const allowed = [...new Set(found.map((candidate) => candidate.route.method))];
    // `HEAD` روی `GET` مجاز است: هر خواندنی، پاسخ بی‌بدنه هم دارد.
    if (method === 'HEAD') {
      const viaGet = found.find((candidate) => candidate.route.method === 'GET');
      if (viaGet) return { kind: 'match', match: { route: viaGet.route, params: viaGet.params } };
    }

    return { kind: 'method_not_allowed', allowed };
  }
}

export function splitPath(pathname: string): string[] {
  return pathname.split('/').filter((part) => part !== '');
}
