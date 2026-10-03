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

import { clampDescription } from '@petavu/seo';

import { breadcrumb, badge, container, heading, paragraph, section } from '../components.js';
import { PLATFORM_NAME, renderShell, verificationBadge } from '../chrome.js';
import { escapeText } from '../html.js';
import { breadcrumbList, businessNode, jsonLdBlocks } from '../structured.js';
import { renderDesignPage } from '../pagedesign.js';
import { buildPageHead } from '../seohead.js';
import { industryUrl, locationUrl, typeUrl } from '../taxonomy.js';
import { businessGrid, editorialSection, facetSection, type Facet } from './landing.js';
import { notFoundPage } from './system.js';
import type { PageContext, PageResponse } from './types.js';

export async function businessPage(context: PageContext, slug: string): Promise<PageResponse> {
  const { config, site, url, settings, requestId } = context;
  const origin = config.env.origins.public;
  const locale = settings?.default_locale ?? 'fa-IR';

  const found = await context.data.businessBySlug(slug, requestId);
  if (!found) return notFoundPage(context, { reason: 'business_not_found' });

  const { business } = found;
  const canonical = `${origin}/b/${business.slug}`;
  const typeLabel = business.type_name ?? business.business_type_key;
  const typePath = typeUrl(business.business_type_key);

  /*
   * پیوند داخلی (گام ۲۶): پروفایلی که فقط از فهرست به آن می‌رسند، یتیمِ ضعیف
   * است. دو منبع: «مشابه‌ها» (هم‌نوع، با چرخش پایدار) و پیوندهای سراسریِ
   * ثبت‌شده در `seo.internal_link`. هر دو در پایین صفحه می‌آیند — چه صفحه از
   * درخت طراحی بیاید چه از چیدمان پایه، پیوند ورودی/خروجی باید ثابت بماند.
   */
  const [related, editorialLinks] = await Promise.all([
    context.data.relatedBusinesses(business, 6, requestId),
    context.data.internalLinks(`/b/${business.slug}`, requestId),
  ]);

  /*
   * این دو، **پیش‌فرض کد** هستند؛ زنجیرهٔ واقعی (متادیتای دستی → قالب سئو)
   * در `buildPageHead` اجرا می‌شود. سیاست نمایه‌شدن هم از همان‌جا و از
   * `seo.metadata` می‌آید — «سئو به‌عنوان داده» (Addendum §۴۱).
   */
  const title = `${business.name} | ${PLATFORM_NAME}`;
  const description = clampDescription(
    business.summary ?? business.tagline ?? `${business.name} — پروفایل عمومی در ${PLATFORM_NAME}.`,
  );

  /*
   * زنجیرهٔ عنوان داده‌محور است: متادیتای دستی → قالب `business.default`
   * (اگر ثبت شده باشد) → عنوان پیش‌فرض. کانونیکال هم از قاعدهٔ `seo.canonical`
   * عبور می‌کند و پارامترهای ردیابی هرگز در آن نمی‌مانند.
   */
  const head = await buildPageHead({
    context,
    site,
    path: `/b/${business.slug}`,
    search: url.searchParams,
    entity: {
      kind: 'business',
      id: business.id,
      routeKey: null,
      values: {
        name: business.name,
        name_latin: business.name_latin,
        city: business.city_name,
        city_name: business.city_name,
        type: typeLabel,
        summary: business.summary,
        tagline: business.tagline,
        slug: business.slug,
      },
    },
    fallbackTitle: title,
    fallbackDescription: description,
    indexable: site.indexable,
    og: { type: 'website', image: null },
  });

  const facts: string[] = [];
  if (business.city_name) facts.push(`شهر: ${business.city_name}`);
  if (business.founded_year) facts.push(`سال تأسیس: ${business.founded_year}`);
  if (Number(business.listing_count) > 0) facts.push(`آگهی فعال: ${business.listing_count}`);

  const baseline = [
    section({
      tight: true,
      children: container(
        breadcrumb([
          { label: 'خانه', href: '/' },
          ...(typePath ? [{ label: typeLabel, href: typePath }] : [{ label: 'کسب‌وکارها', href: '/businesses' }]),
          { label: business.name },
        ]),
      ),
    }),
    section({
      children: container(
        heading(1, business.name) +
          (business.name_latin ? paragraph(business.name_latin, 'card__meta') : '') +
          `<div class="cluster section--tight">${verificationBadge(business.verification_level) ?? ''}${badge(typeLabel)}</div>` +
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
      type_name: typeLabel,
      city: business.city_name ?? '',
    },
  });

  // مسیرهای «بیشتر»: نوع، صنف و شهر همین کسب‌وکار — هر کدام صفحهٔ واقعی دارند.
  const exploreChips: Facet[] = [
    ...(typePath ? [{ label: typeLabel, href: typePath }] : []),
    ...(business.industry_path && business.industry_name && industryUrl(business.industry_path)
      ? [{ label: business.industry_name, href: industryUrl(business.industry_path) as string }]
      : []),
    ...(business.city_path && business.city_name && locationUrl(business.city_path) && locationUrl(business.city_path) !== '/l'
      ? [{ label: `کسب‌وکارها در ${business.city_name}`, href: locationUrl(business.city_path) as string }]
      : []),
  ];

  const extras = [
    facetSection('کاوش بیشتر', exploreChips, 'explore'),
    related.length > 0 ? `<div class="section--tight stack" id="related">${heading(2, 'کسب‌وکارهای مشابه', { class: 'ds-heading ds-heading--sm' })}${businessGrid(related)}</div>` : '',
    editorialSection(editorialLinks),
  ].join('');

  const main = design.used ? design.html ?? baseline : baseline;
  const body = extras.trim() === '' ? main : `${main}\n<section class="section section--tight">${container(extras)}</section>`;

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
        ...(typePath ? [{ name: typeLabel, url: typePath }] : [{ name: 'کسب‌وکارها', url: '/businesses' }]),
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
    headTags: head.tags,
    theme: context.theme,
    fonts: context.fonts,
    assets: context.assets,
    chrome: context.chrome,
    now: context.now,
    content: body,
    jsonLd: jsonLdBlocks({
      baseUrl: origin,
      brandName: PLATFORM_NAME,
      locale,
      // نودهای سئوی داده‌محور، در همان گراف صفحه ادغام می‌شوند.
      nodes: [...nodes, ...head.structuredNodes],
    }),
    bodyClass: 'page-business',
  });

  return { status: 200, kind: 'html', body: html };
}
