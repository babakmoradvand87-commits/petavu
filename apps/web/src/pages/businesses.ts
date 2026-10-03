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

import { clampDescription } from '@petavu/seo';

import { breadcrumb, card, container, emptyState, heading, paragraph, section, badge } from '../components.js';
import { PLATFORM_NAME, renderShell, verificationBadge } from '../chrome.js';
import { escapeText } from '../html.js';
import { breadcrumbList, jsonLdBlocks } from '../structured.js';
import { buildPageHead } from '../seohead.js';
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

  /*
   * کانونیکال این صفحه **همیشه** `/businesses` است، حتی وقتی فیلتر نوع فعال
   * است؛ فیلتر، محتوای تکراری می‌سازد و نشانگرِ «کدام نسخه مرجع است» باید
   * یک‌جا (اینجا) گفته شود. قاعدهٔ عمومی `seo.canonical` هم می‌تواند دستکاری‌اش
   * کند، ولی مسیر صفحه در `path` داده می‌شود تا قاعده با آن سنجیده شود.
   */
  const head = await buildPageHead({
    context,
    site,
    path: '/businesses',
    search: url.searchParams,
    entity: {
      /*
       * «جست‌وجوی متنی» و «فهرست دسته‌بندی‌شده» دو چیزند: فهرست باید نمایه شود
       * (راه ورود به پروفایل‌هاست)، ولی نتیجهٔ جست‌وجوی آزاد، صفحهٔ کم‌ارزشی است
       * که باید `noindex, follow` بگیرد. پس نوع، از وجود پرس‌وجو تعیین می‌شود.
       */
      kind: url.searchParams.get('q') ? 'search' : 'listing',
      id: null,
      routeKey: '/businesses',
      values: { name: 'کسب‌وکارها', type: typeKey ?? 'کسب‌وکار' },
    },
    fallbackTitle: title,
    fallbackDescription: clampDescription(
      `${page.items.length > 0 ? page.items.length : PAGE_SIZE} کسب‌وکار فعال در صنعت حیوانات خانگی و اسب — فهرست زندهٔ ${PLATFORM_NAME}.`,
    ),
    // صفحه‌های بعدی: `noindex, follow` — محتوا نمایه می‌شود، صفحهٔ نشانگری نه.
    indexable: site.indexable && isFirstPage,
    nonIndexableReason: isFirstPage ? null : 'paginated',
    extraDirectives: isFirstPage ? [] : ['noindex', 'follow'],
    // نشانگر صفحه‌بندی، بخشی از هویت صفحهٔ دوم است؛ بقیهٔ پارامترها نه.
    canonicalKeepParams: ['cursor'],
    pagination: { next: nextUrl },
    og: { type: 'website' },
  });

  void locale;

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
    bodyClass: 'page-businesses',
  });

  return { status: 200, kind: 'html', body: html };
}
