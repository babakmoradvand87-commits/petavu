/**
 * فهرست کسب‌وکارها (گام ۲۲؛ §19–۲۰، Addendum §۲۰–۲۱، §۵۳).
 *
 * صفحه‌بندی **نشانگری** است، نه `offset`: با `offset`، هر کسب‌وکار تازه‌ای که
 * ثبت می‌شود ردیف‌ها را جابه‌جا می‌کند و صفحهٔ دوم می‌تواند یک مورد را دوبار
 * نشان دهد یا از قلم بیندازد.
 *
 * سئوی صفحه‌بندی، طبق توصیهٔ خود گوگل: صفحهٔ اول `canonical` و `rel=next`؛
 * صفحه‌های بعدی `noindex, follow` و **بدون** کانونیکال به صفحهٔ اول. این‌گونه
 * محتوا نمایه می‌شود، ولی صفحه‌های نشانگری، محتوای تکراری نمی‌سازند.
 */

import { buildHead, clampDescription } from '@petavu/seo';

import { breadcrumb, card, container, emptyState, heading, paragraph, section, badge } from '../components.js';
import { PLATFORM_NAME, renderShell, verificationBadge } from '../chrome.js';
import { escapeText } from '../html.js';
import { breadcrumbList, jsonLdBlocks } from '../structured.js';
import type { PageContext, PageResponse } from './types.js';

const PAGE_SIZE = 24;

export async function businessesPage(context: PageContext): Promise<PageResponse> {
  const { config, site, url, settings, requestId } = context;
  const origin = config.env.origins.public;
  const locale = settings?.default_locale ?? 'fa-IR';

  const cursor = url.searchParams.get('cursor');
  const typeKey = url.searchParams.get('type');

  const page = await context.data.listPublicBusinesses(
    { limit: PAGE_SIZE, cursor, businessTypeKey: typeKey?.trim() || null },
    requestId,
  );

  const isFirstPage = !cursor;
  const title = isFirstPage
    ? `کسب‌وکارهای صنعت حیوانات خانگی و اسب | ${PLATFORM_NAME}`
    : `کسب‌وکارها — صفحهٔ بعد | ${PLATFORM_NAME}`;

  const nextUrl = page.nextCursor ? `${origin}/businesses?cursor=${encodeURIComponent(page.nextCursor)}${typeKey ? `&type=${encodeURIComponent(typeKey)}` : ''}` : null;

  const headTags = buildHead({
    url: `${origin}/businesses`,
    title,
    description: clampDescription(
      `${page.items.length > 0 ? page.items.length : PAGE_SIZE} کسب‌وکار فعال در صنعت حیوانات خانگی و اسب — فهرست زندهٔ ${PLATFORM_NAME}.`,
    ),
    locale,
    canonical: `${origin}/businesses`,
    indexable: site.indexable && isFirstPage,
    // صفحه‌های بعدی: `noindex, follow` — محتوا نمایه می‌شود، صفحهٔ نشانگری نه.
    nonIndexableReason: isFirstPage ? null : 'paginated',
    robots: isFirstPage ? undefined : ['noindex', 'follow'],
    environment: config.environment,
    pagination: { next: nextUrl },
    og: { type: 'website', siteName: PLATFORM_NAME, locale },
  });

  const items = page.items.map((business) =>
    card({
      title: business.name,
      href: `/b/${business.slug}`,
      meta: [business.tagline, business.city_name].filter(Boolean).join(' — ') || undefined,
      raised: true,
      body:
        paragraph(business.summary ?? 'اطلاعات این کسب‌وکار در پروفایل عمومی‌اش آمده است.') +
        `<div class="cluster">${verificationBadge(business.verification_level) ?? ''}${badge(business.business_type_key)}</div>`,
    }),
  );

  const listing =
    items.length > 0
      ? `<div class="grid grid--3 section--tight">${items.join('')}</div>` +
        (nextUrl
          ? `<nav class="cluster cluster--between section--tight" aria-label="صفحه‌بندی">` +
            `<a class="button button--ghost" rel="next" href="/businesses?cursor=${encodeURIComponent(page.nextCursor as string)}${typeKey ? `&type=${encodeURIComponent(typeKey)}` : ''}">صفحهٔ بعد</a>` +
            `<span class="field__hint">${escapeText('فهرست با نشانگر پیمایش می‌شود؛ موردی از قلم نمی‌افتد.')}</span>` +
            `</nav>`
          : '')
      : emptyState('هنوز کسب‌وکاری پروفایل عمومی منتشر نکرده است. به‌زودی این فهرست پر می‌شود.');

  const body = [
    section({
      tight: true,
      children: container(breadcrumb([{ label: 'خانه', href: '/' }, { label: 'کسب‌وکارها' }])),
    }),
    section({
      children: container(
        heading(1, 'کسب‌وکارهای حاضر در شبکه') +
          paragraph(
            typeKey ? `این فهرست با فیلتر «${typeKey}» نشان داده می‌شود.` : 'همهٔ کسب‌وکارهایی که پروفایل عمومی فعال دارند.',
            'field__hint',
          ) +
          listing,
      ),
    }),
  ].join('\n');

  const nodes = [
    breadcrumbList(
      [
        { name: 'خانه', url: '/' },
        { name: 'کسب‌وکارها', url: '/businesses' },
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
    bodyClass: 'page-businesses',
  });

  return { status: 200, kind: 'html', body: html };
}
