/**
 * آماده‌سازی دوزبانه — گام ۳۹؛ §123–۱۲۵.
 *
 * فارسی پیش‌فرض است. انگلیسی فقط وقتی فعال می‌شود که درخواست صریح باشد
 * (`?hl=en` یا `Accept-Language: en`). دادهٔ کسب‌وکار ترجمهٔ خودکار نمی‌شود.
 */

export const SUPPORTED_LOCALES = ['fa-IR', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'fa-IR';

const MESSAGES = {
  'fa-IR': {
    platform_name: 'پِتاوو',
    tagline: 'شبکهٔ کسب‌وکارهای صنعت حیوانات خانگی و اسب',
    backup_unverified: 'پشتیبان بدون آزمون بازیابی معتبر نیست',
    restore_required: 'بازیابی باید روی محیط تازه آزموده شود',
  },
  en: {
    platform_name: 'PETAVU',
    tagline: 'B2B network for the pet and equine industry',
    backup_unverified: 'A backup without a restore test is not a backup',
    restore_required: 'Restore must be proven on a fresh environment',
  },
} as const;

export type MessageKey = keyof (typeof MESSAGES)['fa-IR'];

export function parseLocale(raw: string | null | undefined): SupportedLocale {
  if (!raw) return DEFAULT_LOCALE;
  const token = raw.split(',')[0]?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (token === 'en' || token.startsWith('en-')) return 'en';
  if (token === 'fa' || token.startsWith('fa-')) return 'fa-IR';
  return DEFAULT_LOCALE;
}

export function localeFromRequest(input: { searchParams?: URLSearchParams; acceptLanguage?: string | null }): SupportedLocale {
  const hl = input.searchParams?.get('hl');
  if (hl) return parseLocale(hl);
  return parseLocale(input.acceptLanguage);
}

export function t(locale: SupportedLocale, key: MessageKey): string {
  return MESSAGES[locale][key];
}

export function directionFor(locale: SupportedLocale): 'rtl' | 'ltr' {
  return locale === 'en' ? 'ltr' : 'rtl';
}
