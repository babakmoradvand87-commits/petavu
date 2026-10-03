/**
 * اتصال صفحه‌ها به درخت طراحی (گام ۲۳؛ §35–۳۸، §103، §161–۱۶۹).
 *
 * این ماژول **تنها** جایی است که «صفحهٔ کدنوشته» و «صفحهٔ ساخته‌شده از درخت»
 * به هم می‌رسند. سه قاعده:
 *
 *   ۱. **درخت منتشرشده، حاکم است.** اگر صفحهٔ منتشرشده‌ای برای این کلید وجود
 *      داشته باشد، همان رندر می‌شود. اگر نباشد، صفحه به چیدمان پایهٔ کد
 *      برمی‌گردد — نه به یک صفحهٔ خالی.
 *   ۲. **داده، پس از پیش‌اسکن خوانده می‌شود.** تا وقتی ندانیم درخت به فهرست
 *      کسب‌وکار یا محتوا نیاز دارد، آن را نمی‌خوانیم (Addendum §۲۰: پرهیز از
 *      خواندن بی‌مصرف و N+1).
 *   ۳. **هر یافته، لاگ می‌شود.** «کامپوننتی رندر نشد» یا «پراپی دور ریخته شد»
 *      باید در مشاهده‌پذیری دیده شود، وگرنه سکوت، خرابی پنهان می‌سازد.
 */

import type { Logger } from '@petavu/shared';

import { mediaViewOf, type MediaAssetRow } from './media.js';
import { findingsDigest, type Finding } from './registry.js';
import { renderTree, scanTree, type TreeNeed } from './tree.js';
import type {
  BusinessCardView,
  BusinessView,
  ContactView,
  ContentCardView,
  MediaView,
  TreeData,
} from './renderers.js';
import type { BusinessContactRow, BusinessLocationRow, ContentIndexRow, PublicBusinessRow } from './data.js';
import type { PageContext } from './pages/types.js';

export interface DesignPageInput {
  readonly context: PageContext;
  /** `null` ⇒ صفحهٔ سراسری پلتفرم (مثل صفحهٔ اصلی). */
  readonly businessId: string | null;
  /** کلید صفحه در `design.page` — `home`, `about`, … */
  readonly key: string;
  /** متن‌های زمینه برای نگه‌دارنده‌ها: `{business_name}`, `{tagline}`, … */
  readonly strings: Readonly<Record<string, string>>;
  /** نشانی مطلق این صفحه (برای اشتراک‌گذاری و لینک‌های ساخت‌یافته). */
  readonly pageUrl: string;
  /** ردیف کسب‌وکار، اگر صفحه در بافت کسب‌وکار است. */
  readonly business?: PublicBusinessRow | null;
  /** سقف اعضای فهرست‌های داده‌محور. */
  readonly listLimit?: number;
}

export interface DesignPageResult {
  /** `null` ⇒ درختی منتشر نشده بود؛ صفحه باید چیدمان پایه را بریزد. */
  readonly html: string | null;
  /** آیا درخت، `h1` خودش را داشت؟ (نبودش ⇒ صفحه باید عنوان پایه بگذارد.) */
  readonly hasH1: boolean;
  readonly weightKb: number;
  readonly findings: readonly Finding[];
  readonly used: boolean;
}

const NO_TREE: DesignPageResult = { html: null, hasH1: false, weightKb: 0, findings: [], used: false };

export async function renderDesignPage(input: DesignPageInput): Promise<DesignPageResult> {
  const { context } = input;
  const requestId = context.requestId;
  const registry = context.registry;

  /*
   * Registry نبود ⇒ درخت رندر نمی‌شود. این «خرابی» نیست، «فقدان ظرفیت» است:
   * صفحه به چیدمان پایه برمی‌گردد و همان کار می‌کند.
   */
  if (!registry || registry.size === 0) {
    return NO_TREE;
  }

  const raw = await context.data.pageTree({ businessId: input.businessId, key: input.key }, requestId);
  if (raw === null) return NO_TREE;

  const scan = scanTree(raw, { registry, strings: input.strings });

  const [data, media] = await Promise.all([
    loadTreeData(input, scan.needs),
    loadMedia(input, scan.assetIds),
  ]);

  const rendered = renderTree({
    scan,
    registry,
    strings: input.strings,
    data,
    pageUrl: input.pageUrl,
    locale: context.settings?.default_locale ?? 'fa-IR',
    media: media.size === 0 ? null : (assetId) => media.get(assetId) ?? null,
  });

  logFindings(context.logger, input.key, requestId, rendered.findings, {
    nodes: rendered.renderedNodes,
    weightKb: rendered.weightKb,
    skipped: rendered.skipped,
  });

  if (rendered.html.trim() === '') {
    context.logger.warn('درخت طراحی چیزی برای رندر نداشت؛ چیدمان پایه اجرا می‌شود', {
      requestId,
      pageKey: input.key,
      skipped: rendered.skipped,
    });
    return { ...NO_TREE, findings: rendered.findings };
  }

  return {
    html: rendered.html,
    hasH1: rendered.hasH1,
    weightKb: rendered.weightKb,
    findings: rendered.findings,
    used: true,
  };
}

async function loadTreeData(input: DesignPageInput, needs: ReadonlySet<TreeNeed>): Promise<TreeData> {
  const { context } = input;
  const limit = input.listLimit ?? 6;

  const [businesses, contents, businessContext] = await Promise.all([
    needs.has('businesses')
      ? context.data.featuredBusinesses(limit, context.requestId)
      : Promise.resolve([] as PublicBusinessRow[]),
    needs.has('contents') ? context.data.contentIndex(limit, context.requestId) : Promise.resolve([] as ContentIndexRow[]),
    needs.has('business') && input.businessId
      ? context.data.businessContext(input.businessId, context.requestId)
      : Promise.resolve({ locations: [] as BusinessLocationRow[], contacts: [] as BusinessContactRow[] }),
  ]);

  return {
    businesses: businesses.map(toBusinessCard),
    contents: contents.map(toContentCard),
    business: input.business
      ? buildBusinessView(input.business, businessContext.locations, businessContext.contacts, context.config.env.origins.public)
      : null,
  };
}

async function loadMedia(input: DesignPageInput, assetIds: readonly string[]): Promise<Map<string, MediaView>> {
  const map = new Map<string, MediaView>();
  if (assetIds.length === 0) return map;

  const rows = await input.context.data.mediaAssets(assetIds, input.context.requestId);
  for (const row of rows as MediaAssetRow[]) {
    const view = mediaViewOf(row);
    if (view) map.set(row.id, view);
  }

  const missing = assetIds.filter((id) => !map.has(id));
  if (missing.length > 0) {
    input.context.logger.warn('دارایی رسانه‌ای قابل‌استفاده نبود', {
      requestId: input.context.requestId,
      requested: assetIds.length,
      unusable: missing.length,
    });
  }

  return map;
}

function toBusinessCard(row: PublicBusinessRow): BusinessCardView {
  return {
    name: row.name,
    url: `/b/${row.slug}`,
    summary: row.summary ?? row.tagline,
    cityName: row.city_name,
  };
}

function toContentCard(row: ContentIndexRow): ContentCardView {
  return {
    title: row.title,
    url: row.business_slug ? `/${row.slug}` : `/${row.slug}`,
    summary: null,
    publishedAt: row.published_at ?? null,
  };
}

/* ------------------------------------------------------------------ بافت کسب‌وکار */

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
  business: PublicBusinessRow,
  locations: readonly BusinessLocationRow[],
  contacts: readonly BusinessContactRow[],
  origin: string,
): BusinessView {
  const primary = locations.find((location) => location.is_primary) ?? locations[0] ?? null;

  const contactViews: ContactView[] = contacts.map((contact) => ({
    kind: contact.kind,
    display: contact.value_display,
    label: contact.label ?? CONTACT_LABELS[contact.kind] ?? contact.kind,
    href: contactHref(contact.kind, contact.value_display),
  }));

  const latitude = primary ? Number(primary.latitude) : Number.NaN;
  const longitude = primary ? Number(primary.longitude) : Number.NaN;

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

/* ------------------------------------------------------------------ لاگ */

function logFindings(
  logger: Logger,
  pageKey: string,
  requestId: string,
  findings: readonly Finding[],
  context: Readonly<Record<string, unknown>>,
): void {
  if (findings.length === 0) return;

  const blockers = findings.filter((finding) => finding.severity === 'blocker').length;
  const record = {
    requestId,
    pageKey,
    count: findings.length,
    blockers,
    digest: findingsDigest(findings),
    ...context,
  };

  if (blockers > 0) logger.warn('یافته‌های مسدودکننده در درخت صفحه', record);
  else logger.debug('یافته‌های درخت صفحه', record);
}
