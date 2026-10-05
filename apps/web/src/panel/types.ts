/**
 * قراردادهای پنل (گام ۲۸). یک بخش (Section) یک تابع رندر دارد و چند کنش (فرم POST)؛ هیچ حالت پنهانی
 * بین دو درخواست نمی‌ماند، و هیچ بخشی به پایگاه‌داده دست نمی‌زند — فقط از `ctx.api` (API).
 */

import type { Flash } from './kit.js';
import type { ApiResponse } from './api.js';
import type { Form } from './forms.js';

export type PanelSurface = 'panel' | 'admin' | 'shop' | 'admin_shop';

export interface PanelBusiness {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly role_key: string | null;
}

export interface PanelSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly platformRole: string | null;
  readonly impersonatedBy?:string|null;
  readonly activeBusinessId: string | null;
  readonly businesses: readonly PanelBusiness[];
  /** توکن CSRF نشست؛ هر فرم تغییردهنده آن را می‌فرستد و API می‌سنجد. */
  readonly csrf: string;
}

export interface PanelCtx {
  readonly surface: PanelSurface;
  readonly publicOrigin: string;
  readonly session: PanelSession;
  readonly url: URL;
  readonly form: Form | null;
  readonly csrf: string;
  /** فراخوانی API با نشست و کسب‌وکار فعال؛ کوکی‌های پاسخ به مرورگر می‌رسند. */
  api(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<ApiResponse>;
  /** `/api/v1/businesses/<فعال>` + پسوند؛ بی‌کسب‌وکار فعال خطا می‌دهد (صفحه آن را می‌گیرد). */
  businessPath(suffix?: string): string;
}

export interface SectionRender {
  readonly html: string;
  readonly status?: number;
}

export interface ActionRedirect {
  /** مسیر داخلی پنل؛ هرگز نشانی بیرونی (هدایت باز ممنوع). */
  readonly redirect: string;
  readonly flash?: Flash;
}

/**
 * نمایش مستقیم، بی‌هدایت: فقط برای رازی که **یک‌بار** باید دیده شود (کلید API تازه). رازِ داخل کوکیِ پیام
 * (الگوی PRG) نمی‌گذاریم؛ صفحه مستقیم ساخته می‌شود و هیچ‌جا نمی‌ماند.
 */
export interface ActionPage {
  readonly page: { readonly title: string; readonly html: string; readonly themeCss?: string; readonly previewDoc?: string; readonly status?: number };
}

export type ActionOutcome = ActionRedirect | ActionPage;

export interface Section {
  readonly key: string;
  readonly title: string;
  render(ctx: PanelCtx): Promise<SectionRender>;
  /** کنش‌ها، با نامِ آخرِ مسیر (`/app/team/invite` ⇒ `invite`). فقط POST. */
  readonly actions?: Readonly<Record<string, (ctx: PanelCtx) => Promise<ActionOutcome>>>;
}

export type SectionRegistry = Readonly<Record<string, Section>>;
