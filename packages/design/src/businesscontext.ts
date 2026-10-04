import type {Row} from '@petavu/db';
import type {BusinessView,ContactView} from './renderers.js';
export interface BusinessContextRow extends Row{id:string;slug:string;name:string;type_name:string|null;business_type_key:string;city_name:string|null}
export interface LocationContextRow extends Row{label:string|null;address_line:string|null;latitude:string|number|null;longitude:string|number|null;hours:unknown;is_primary:boolean}
export interface ContactContextRow extends Row{kind:string;value_display:string;label:string|null;is_public:boolean}
const DAY_LABELS: Readonly<Record<string, string>> = {
  sat: 'شنبه',
  sun: 'یک‌شنبه',
  mon: 'دوشنبه',
  tue: 'سه‌شنبه',
  wed: 'چهارشنبه',
  thu: 'پنج‌شنبه',
  fri: 'جمعه',
};

/**
 * قالب‌بندی ساعات کار.
 *
 * شکل داده `{sat:{open,close},…}` است و برای بازهٔ دوتایی، آرایه‌ای از بازه‌ها
 * می‌آید. خروجی، متن فارسی خوانا است — و اگر شکل ناشناخته بود، **هیچ** نمی‌گوییم
 * (حدس زدن ساعت کار یک کسب‌وکار، اطلاعات نادرست به کاربر می‌دهد).
 */
export function formatHours(hours: unknown): string[] {
  if (typeof hours !== 'object' || hours === null || Array.isArray(hours)) return [];
  const out: string[] = [];

  for (const [day, value] of Object.entries(hours as Record<string, unknown>)) {
    const label = DAY_LABELS[day];
    if (!label) continue;

    const ranges: Array<{ open: string; close: string }> = [];
    const push = (entry: unknown): void => {
      if (typeof entry !== 'object' || entry === null) return;
      const record = entry as Record<string, unknown>;
      const open = typeof record['open'] === 'string' ? record['open'] : null;
      const close = typeof record['close'] === 'string' ? record['close'] : null;
      if (open && close) ranges.push({ open, close });
    };

    if (Array.isArray(value)) value.forEach(push);
    else push(value);

    if (ranges.length === 0) continue;
    out.push(`${label} ${ranges.map((range) => `${range.open}–${range.close}`).join('، ')}`);
  }

  return out;
}

/** نشانی قابل‌کلیک هر راه تماس — فقط برای شکل‌هایی که با اطمینان می‌شناسیم. */
export function contactHref(kind: string, display: string): string | null {
  const trimmed = display.trim();
  if (trimmed === '' || trimmed.length > 200) return null;

  const digits = trimmed.replace(/[^\d+]/g, '');
  const handle = trimmed.replace(/^@/, '').replace(/[^A-Za-z0-9._-]/g, '');

  switch (kind) {
    case 'phone':
    case 'mobile':
    case 'fax':
      return kind === 'fax' ? null : /^\+?\d{6,15}$/.test(digits) ? `tel:${digits}` : null;
    case 'email':
      return /^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed) ? `mailto:${trimmed}` : null;
    case 'whatsapp':
      return /^\+?\d{8,15}$/.test(digits) ? `https://wa.me/${digits.replace(/^\+/, '')}` : null;
    case 'telegram':
      return handle.length > 0 ? `https://t.me/${handle}` : null;
    case 'instagram':
      return handle.length > 0 ? `https://instagram.com/${handle}` : null;
    case 'website':
      return /^https:\/\//i.test(trimmed) ? trimmed : null;
    default:
      return null;
  }
}

const CONTACT_LABELS: Readonly<Record<string, string>> = {
  phone: 'تلفن',
  mobile: 'همراه',
  email: 'ایمیل',
  whatsapp: 'واتس‌اپ',
  telegram: 'تلگرام',
  instagram: 'اینستاگرام',
  website: 'وب‌سایت',
  fax: 'نمابر',
};

/**
 * نمای زمینهٔ کسب‌وکار برای `content.contact_block` و `content.map`.
 *
 * نشانی از **مکان اصلی** می‌آید و تماس‌ها فقط از ردیف‌هایی که کسب‌وکار عمومی
 * کرده است. هیچ‌چیز از جای دیگری «کشیده» نمی‌شود.
 */
export function buildBusinessView(
  business: BusinessContextRow,
  locations: readonly LocationContextRow[],
  contacts: readonly ContactContextRow[],
  origin: string,
): BusinessView {
  const primary = locations.find((location) => location.is_primary) ?? locations[0] ?? null;

  const contactViews: ContactView[] = contacts.map((contact) => ({
    kind: contact.kind,
    display: contact.value_display,
    label: contact.label ?? CONTACT_LABELS[contact.kind] ?? contact.kind,
    href: contactHref(contact.kind, contact.value_display),
  }));

  const latitude = primary?.latitude != null ? Number(primary.latitude) : Number.NaN;
  const longitude = primary?.longitude != null ? Number(primary.longitude) : Number.NaN;

  return {
    id: business.id,
    slug: business.slug,
    name: business.name,
    typeName: business.type_name ?? business.business_type_key,
    cityName: business.city_name,
    url: `${origin}/b/${business.slug}`,
    address: primary?.address_line ?? null,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    hours: primary ? formatHours(primary.hours) : [],
    contacts: contactViews,
  };
}

