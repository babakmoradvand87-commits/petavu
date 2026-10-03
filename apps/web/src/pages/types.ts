/**
 * قرارداد صفحه‌ها (گام ۲۲).
 *
 * یک صفحه، یک تابع: `(زمینه) ⇒ پاسخ`. نه کلاس، نه ثبت‌نام سراسری، نه حالت
 * پنهان. پیامدهایش دقیقاً همان چیزی است که لازم داریم: هر صفحه مستقل آزمون
 * می‌شود، و «حالت» هرگز بین دو درخواست جا نمی‌ماند.
 *
 * پاسخ، **سند کامل** است یا **متنی خام** — و «نوع» را خود صفحه می‌گوید. سرور
 * نمی‌تواند حدس بزند؛ و حدس زدن درست، همان چیزی است که تولید محتوای خراب
 * را ممکن می‌کند.
 */

import type { Logger } from '@petavu/shared';

import type { AssetRegistry } from '../assets.js';
import type { ComponentRegistry } from '../registry.js';
import type { SitePolicy, WebConfig } from '../config.js';
import type { ContentIndexRow, PlatformPageRow, PublicBusinessRow, SeoSettingsRow, WebData, PlatformStats } from '../data.js';
import type { FontSetup } from '../fonts.js';
import type { ThemeBundle } from '../theme.js';

export type ResponseKind = 'html' | 'text' | 'xml' | 'json';

export interface PageResponse {
  readonly status: number;
  readonly kind: ResponseKind;
  readonly body: string;
  /** هدرهای اضافی؛ مثلاً `location` برای ۳۰۱ یا `allow` برای ۴۰۵. */
  readonly headers?: Record<string, string>;
  /** `false` = این پاسخ هرگز نباید کش شود (صفحهٔ خطا، هدایت). */
  readonly cacheable?: boolean;
  /** `false` = سریال‌سازی JSON-LD و هدرهای سئو معنا ندارند. */
  readonly seo?: boolean;
}

export interface PageContext {
  readonly config: WebConfig;
  readonly site: SitePolicy;
  readonly url: URL;
  readonly requestId: string;
  readonly data: WebData;
  readonly assets: AssetRegistry;
  readonly fonts: FontSetup;
  readonly theme: ThemeBundle;
  readonly settings: SeoSettingsRow | null;
  /** نام نمایشی پلتفرم — از تنظیمات سئو یا نام پیش‌فرض برند. */
  readonly siteName: string;
  /** تاریخ مرجع رندر (برای «سال جاری» در پاورقی) — تنها منبع زمان. */
  readonly now: Date;
  /** پیوند پاورقی، داده‌محور: صفحه‌های منتشرشدهٔ پلتفرم. */
  readonly chrome: ChromeData;
  /**
   * Registry کامپوننت‌ها (گام ۲۳). `null` یعنی بارگذاری نشده — در آن حالت
   * صفحه به چیدمان پایه برمی‌گردد و **خطا نمی‌دهد**.
   */
  readonly registry: ComponentRegistry | null;
  readonly logger: Logger;
}

export interface ChromeData {
  readonly pages: readonly PlatformPageRow[];
  readonly stats: PlatformStats;
  readonly featured: readonly PublicBusinessRow[];
  readonly contents: readonly ContentIndexRow[];
}

export type PageHandler = (context: PageContext) => Promise<PageResponse> | PageResponse;
