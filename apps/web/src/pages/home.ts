/**
 * صفحهٔ اصلی (گام ۲۲؛ §25، §45–۴۷، Addendum §۳۰–۳۱).
 *
 * ساختار اسکرولی از بالا به پایین: قهرمان، عددهای واقعی، کسب‌وکارهای شاخص،
 * تازه‌ها. هر بخش فقط وقتی رندر می‌شود که **داده داشته باشد**؛ بخش خالی به‌جای
 * پر شدن با متن بی‌محتوا حذف می‌شود. این عمدی است: صفحهٔ اصلیِ خالی، صادق‌تر
 * از صفحهٔ پرِ جعلی است (§102).
 *
 * دادهٔ ساخت‌یافته: گراف برند (`Organization` + `WebSite` از پکیج سئو) به‌علاوهٔ
 * فهرست کسب‌وکارها و مسیر راهنما.
 */

import { clampDescription } from '@petavu/seo';

import { card, container, emptyState, formatNumber, heading, metric, paragraph, section } from '../components.js';
import { PLATFORM_NAME, PLATFORM_TAGLINE, renderShell } from '../chrome.js';
import { escapeText } from '../html.js';
import { breadcrumbList, itemListNode, jsonLdBlocks } from '../structured.js';
import { renderDesignPage } from '../pagedesign.js';
import { buildPageHead } from '../seohead.js';
import type { PageContext, PageResponse } from './types.js';

/**
 * صفحهٔ اصلی.
 *
 * **دو لایه، یک خروجی.** اگر صفحهٔ `home` در `design.page` منتشر شده باشد،
 * همان درخت رندر می‌شود؛ وگرنه چیدمان پایهٔ کد می‌آید. هر دو لایه دادهٔ
 * ساخت‌یافته، هد سئو و پوستهٔ یکسانی دارند — پس سئو به «کدام لایه رندر شد»
 * گره نمی‌خورد.
 */
export async function homePage(context: PageContext): Promise<PageResponse> {
  const { chrome, config, site, url, settings } = context;
  const origin = config.env.origins.public;
  const locale = settings?.default_locale ?? 'fa-IR';

  const title = `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}`;
  const description = clampDescription(
    settings?.description_fallback ??
      `${PLATFORM_NAME}، شبکهٔ کسب‌وکارهای صنعت حیوانات خانگی و اسب: ${formatNumber(chrome.stats.businesses)} کسب‌وکار، ${formatNumber(chrome.stats.cities)} شهر و ${formatNumber(chrome.stats.industries)} صنعت در یک مرجع زنده.`,
  );

  /*
   * هد از موتور سئو می‌آید: قالب `home.platform` اگر در `seo.template` باشد،
   * بر عنوان پیش‌فرض کد مقدم است — «داده، منبع حقیقت است» (§103).
   */
  const head = await buildPageHead({
    context,
    site,
    path: '/',
    entity: {
      kind: 'home',
      id: null,
      routeKey: '/',
      values: { name: PLATFORM_NAME, tagline: PLATFORM_TAGLINE, type: 'کسب‌وکار' },
    },
    fallbackTitle: title,
    fallbackDescription: description,
    indexable: site.indexable,
    og: { type: 'website' },
  });

  void locale;

  const hero =
    `<section class="hero" id="hero"><div class="container hero__inner">` +
    `<p class="hero__eyebrow">${escapeText(PLATFORM_TAGLINE)}</p>` +
    `<h1 class="hero__title">${escapeText(`${PLATFORM_NAME}؛ جایی که کسب‌وکارهای این صنعت هم‌دیگر را پیدا می‌کنند`)}</h1>` +
    `<p class="hero__lead">${escapeText('فهرست زندهٔ کسب‌وکارها، ظرفیت‌ها و خدمات صنعت حیوانات خانگی و اسب؛ با اطلاعاتی که خودِ کسب‌وکار منتشر کرده و ساختاری که مقایسه را ممکن می‌کند.')}</p>` +
    `<div class="hero__actions cluster">` +
    `<a class="button button--accent" href="/businesses">${escapeText('دیدن کسب‌وکارها')}</a>` +
    `<a class="button button--ghost" href="#stats">${escapeText('عددهای پلتفرم')}</a>` +
    `</div></div></section>`;

  const statsSection = section({
    id: 'stats',
    tight: true,
    children: container(
      heading(2, 'عددها، از خودِ داده‌ها') +
        `<div class="grid grid--4 section--tight">` +
        [
          metric('کسب‌وکار فعال', chrome.stats.businesses),
          metric('شهر', chrome.stats.cities),
          metric('صنعت', chrome.stats.industries),
          metric('نوع کسب‌وکار', chrome.stats.business_types),
        ].join('') +
        `</div>` +
        paragraph('این عددها با هر درخواست از پایگاه‌داده خوانده می‌شوند؛ نه تصویر ثابت‌اند و نه دستی به‌روز می‌شوند.', 'field__hint'),
    ),
  });

  const featuredSection = section({
    id: 'businesses',
    children: container(
      heading(2, 'کسب‌وکارهای حاضر') +
        (chrome.featured.length > 0
          ? `<div class="grid grid--3 section--tight">` +
            chrome.featured
              .map((business) =>
                card({
                  title: business.name,
                  meta: [business.tagline, business.city_name].filter(Boolean).join(' — ') || undefined,
                  href: `/b/${business.slug}`,
                  raised: true,
                  body: paragraph(business.summary ?? 'اطلاعات این کسب‌وکار در پروفایل عمومی‌اش آمده است.'),
                }),
              )
              .join('') +
            `</div>` +
            `<p class="section--tight"><a class="button button--ghost" href="/businesses">همهٔ کسب‌وکارها</a></p>`
          : emptyState('هنوز کسب‌وکاری پروفایل عمومی منتشر نکرده است.') +
            `<p class="section--tight"><a class="button button--ghost" href="/businesses">دیدن فهرست</a></p>`),
    ),
  });

  const contentSection =
    chrome.contents.length > 0
      ? section({
          id: 'latest',
          children: container(
            heading(2, 'تازه‌ها') +
              `<div class="grid grid--2 section--tight">` +
              chrome.contents
                .slice(0, 4)
                .map((item) =>
                  card({
                    title: item.title,
                    meta: item.business_slug ?? PLATFORM_NAME,
                    href: item.business_slug ? `/b/${item.business_slug}` : `/${item.slug}`,
                    body: paragraph(item.kind === 'article' ? 'مقاله' : 'صفحه'),
                  }),
                )
                .join('') +
              `</div>`,
          ),
        })
      : null;

  const nodes = [
    ...(chrome.featured.length > 0
      ? [
          itemListNode(
            chrome.featured.map((business) => ({ name: business.name, url: `/b/${business.slug}` })),
            { baseUrl: origin, brand: { name: PLATFORM_NAME } },
          ),
        ]
      : []),
    breadcrumbList([{ name: 'خانه', url: '/' }], { baseUrl: origin, brandName: PLATFORM_NAME }),
  ];

  const baseline = [hero, statsSection, featuredSection, contentSection]
    .filter((part): part is string => typeof part === 'string')
    .join('\n');

  const design = await renderDesignPage({
    context,
    businessId: null,
    key: 'home',
    pageUrl: `${origin}/`,
    strings: {
      business_name: PLATFORM_NAME,
      tagline: PLATFORM_TAGLINE,
      business_type: 'پلتفرم',
      city: '',
    },
  });

  /*
   * درخت منتشرشدهٔ صفحهٔ اصلی جای چیدمان پایه را می‌گیرد. اگر درخت `h1` نداشت،
   * عنوان سطح‌یک از داده می‌آید — صفحهٔ اصلی بدون `h1`، هم برای صفحه‌خوان و هم
   * برای موتور جست‌وجو ناقص است.
   */
  const body = design.used
    ? (design.hasH1
        ? design.html ?? baseline
        : section({
            tight: true,
            children: container(
              heading(1, `${PLATFORM_NAME}؛ ${PLATFORM_TAGLINE}`) +
                paragraph('فهرست زندهٔ کسب‌وکارهای صنعت حیوانات خانگی و اسب.', 'ds-text ds-text--lg'),
            ),
          }) + (design.html ?? '')
      )
    : baseline;

  const html = renderShell({
    config,
    site,
    url,
    siteName: PLATFORM_NAME,
    headTags: head.tags,
    theme: context.theme,
    fonts: context.fonts,
    assets: context.assets,
    chrome,
    now: context.now,
    content: body,
    jsonLd: jsonLdBlocks({
      baseUrl: origin,
      brandName: PLATFORM_NAME,
      locale,
      // نودهای سئوی داده‌محور، در همان گراف صفحه ادغام می‌شوند.
      nodes: [...nodes, ...head.structuredNodes],
    }),
    bodyClass: 'page-home',
  });

  return { status: 200, kind: 'html', body: html };
}
