/**
 * پروفایل عمومی کسب‌وکار — `/b/:slug` (گام ۲۲؛ §19–۲۲).
 *
 * چرا `404` با نشستِ داده‌ای، نه `403`: وجود یا نبودِ یک کسب‌وکار خصوصی،
 * خودش اطلاعات است. صفحه‌ای که برای «وجود دارد ولی خصوصی است» فرق بگذارد،
 * یک اوراکل افشا می‌سازد. پس هر دو حالت، **همان** پاسخ را می‌گیرند.
 *
 * دادهٔ ساخت‌یافته: `LocalBusiness` از دادهٔ خود پروفایل ساخته می‌شود و
 * `BreadcrumbList` مسیر را می‌گوید. هیچ فیلدی از خودمان اضافه نمی‌شود؛ اگر
 * کسب‌وکار تلفن منتشر نکرده، `telephone` هم در گراف نیست.
 */

import { buildHead, clampDescription } from '@petavu/seo';

import { breadcrumb, badge, container, heading, paragraph, section } from '../components.js';
import { PLATFORM_NAME, renderShell, verificationBadge } from '../chrome.js';
import { escapeText } from '../html.js';
import { breadcrumbList, businessNode, jsonLdBlocks } from '../structured.js';
import { renderDesignPage } from '../pagedesign.js';
import { notFoundPage } from './system.js';
import type { PageContext, PageResponse } from './types.js';

export async function businessPage(context: PageContext, slug: string): Promise<PageResponse> {
  const { config, site, url, settings, requestId } = context;
  const origin = config.env.origins.public;
  const locale = settings?.default_locale ?? 'fa-IR';

  const found = await context.data.businessBySlug(slug, requestId);
  if (!found) return notFoundPage(context, { reason: 'business_not_found' });

  const { business, metadata } = found;
  const canonical = `${origin}/b/${business.slug}`;

  const title = metadata?.title ?? `${business.name} | ${PLATFORM_NAME}`;
  const description = clampDescription(
    metadata?.description ?? business.summary ?? business.tagline ?? `${business.name} — پروفایل عمومی در ${PLATFORM_NAME}.`,
  );

  /*
   * سیاست ایندکس، **داده‌محور** است: اگر فرادادهٔ صفحه بگوید نمایه‌شدنی نیست
   * (`is_indexable = false`)، حتی در محیط تولید هم `noindex` می‌خورد. این همان
   * جایی است که «سئو به‌عنوان داده» به خروجی تبدیل می‌شود (Addendum §۴۱).
   */
  const indexable = site.indexable && (metadata?.is_indexable ?? true);

  const headTags = buildHead({
    url: canonical,
    title,
    description,
    canonical: metadata?.canonical_url ?? canonical,
    indexable,
    nonIndexableReason: metadata?.non_indexable_reason ?? null,
    robots: (metadata?.robots_directives ?? []) as never,
    locale,
    environment: config.environment,
    og: {
      type: 'website',
      title: metadata?.share_title ?? business.name,
      description,
      siteName: PLATFORM_NAME,
      locale,
    },
  });

  const facts: string[] = [];
  if (business.city_name) facts.push(`شهر: ${business.city_name}`);
  if (business.founded_year) facts.push(`سال تأسیس: ${business.founded_year}`);
  if (Number(business.listing_count) > 0) facts.push(`آگهی فعال: ${business.listing_count}`);

  const baseline = [
    section({
      tight: true,
      children: container(
        breadcrumb([{ label: 'خانه', href: '/' }, { label: 'کسب‌وکارها', href: '/businesses' }, { label: business.name }]),
      ),
    }),
    section({
      children: container(
        heading(1, business.name) +
          (business.name_latin ? paragraph(business.name_latin, 'card__meta') : '') +
          `<div class="cluster section--tight">${verificationBadge(business.verification_level) ?? ''}${badge(business.business_type_key)}</div>` +
          (facts.length > 0
            ? `<dl class="grid grid--2 section--tight">` +
              facts
                .map((fact) => {
                  const [label, value] = fact.split(': ');
                  return `<div><dt class="field__hint">${escapeText(label ?? '')}</dt><dd class="metric__value">${escapeText(value ?? '')}</dd></div>`;
                })
                .join('') +
              `</dl>`
            : '') +
          `<div class="prose section">${escapeText(business.summary ?? business.tagline ?? 'این کسب‌وکار هنوز توضیحی منتشر نکرده است.')}</div>`,
      ),
    }),
  ].join('\n');

  /*
   * درخت طراحی این کسب‌وکار (اگر منتشر شده باشد) حاکم است؛ وگرنه چیدمان پایه.
   * عنوان‌های زمینه برای نگه‌دارنده‌های `{business_name}`، `{tagline}`،
   * `{type_name}` و `{city}` از خود ردیف کسب‌وکار می‌آید.
   */
  const design = await renderDesignPage({
    context,
    businessId: business.id,
    key: 'home',
    pageUrl: canonical,
    business,
    strings: {
      business_name: business.name,
      tagline: business.tagline ?? '',
      type_name: business.business_type_key,
      city: business.city_name ?? '',
    },
  });

  const body = design.used ? design.html ?? baseline : baseline;

  const nodes = [
    businessNode({
      baseUrl: origin,
      brandName: PLATFORM_NAME,
      business: {
        name: business.name,
        slug: business.slug,
        summary: business.summary,
        tagline: business.tagline,
        city: business.city_name,
        countryCode: null,
      },
    }),
    breadcrumbList(
      [
        { name: 'خانه', url: '/' },
        { name: 'کسب‌وکارها', url: '/businesses' },
        { name: business.name, url: `/b/${business.slug}` },
      ],
      { baseUrl: origin, brandName: PLATFORM_NAME },
    ),
  ];

  const html = renderShell({
    config,
    site,
    url,
    siteName: PLATFORM_NAME,
    headTags,
    theme: context.theme,
    fonts: context.fonts,
    assets: context.assets,
    chrome: context.chrome,
    now: context.now,
    content: body,
    jsonLd: jsonLdBlocks({ baseUrl: origin, brandName: PLATFORM_NAME, locale, nodes }),
    bodyClass: 'page-business',
  });

  return { status: 200, kind: 'html', body: html };
}
