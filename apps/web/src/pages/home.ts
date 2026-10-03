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

import { card, container, emptyState, formatNumber, heading, metric, paragraph } from '../components.js';
import { PLATFORM_NAME, PLATFORM_TAGLINE, renderShell } from '../chrome.js';
import type { IndustryFacetRow, LocationFacetRow, TypeFacetRow } from '../data.js';
import { escapeAttr, escapeText } from '../html.js';
import { breadcrumbList, itemListNode, jsonLdBlocks } from '../structured.js';
import { renderDesignPage } from '../pagedesign.js';
import { buildPageHead } from '../seohead.js';
import { industryUrl, locationUrl, typeUrl } from '../taxonomy.js';
import { facetChips, type Facet } from './landing.js';
import type { PageContext, PageResponse } from './types.js';

/** سقف اقلام هر صحنه؛ صفحهٔ اصلی «مرور» است، نه فهرست کامل. */
const SCENE_LIMIT = 12;

type SceneTone = 'plain' | 'subtle' | 'dark';

/**
 * یک «صحنه» در پیمایش اسکرولی (§25).
 *
 * صحنه یک `<section>` با عنوان خودش است (`aria-labelledby`)؛ لحن (روشن/ملایم/تاریک)
 * فقط پس‌زمینه را عوض می‌کند و ساختار معنایی یکی می‌ماند. عنصرهای `.rv` با
 * اسکرول نمایان می‌شوند — فقط وقتی مرورگر می‌تواند و کاربر حرکت را نخواسته؛
 * وگرنه همه‌چیز از اول دیده می‌شود (بدون JavaScript، بدون پنهان‌ماندن محتوا).
 */
function scene(options: { id: string; tone?: SceneTone; eyebrow?: string; title: string; lead?: string; body: string }): string {
  const tone = options.tone ?? 'plain';
  const headingId = `${options.id}-title`;
  return (
    `<section class="section scene scene--${tone}" id="${escapeAttr(options.id)}" aria-labelledby="${escapeAttr(headingId)}">` +
    `<div class="container">` +
    `<header class="section-head rv">` +
    (options.eyebrow ? `<p class="section-head__eyebrow">${escapeText(options.eyebrow)}</p>` : '') +
    `<h2 class="section-head__title" id="${escapeAttr(headingId)}">${escapeText(options.title)}</h2>` +
    (options.lead ? `<p class="section-head__lead">${escapeText(options.lead)}</p>` : '') +
    `</header>` +
    `<div class="rv">${options.body}</div>` +
    `</div></section>`
  );
}

function typeCards(types: readonly TypeFacetRow[]): string {
  const cards = types.flatMap((type) => {
    const href = typeUrl(type.key);
    if (!href) return [];
    return [
      card({
        title: type.plural_fa ?? type.name_fa,
        href,
        meta: `${formatNumber(type.business_count)} کسب‌وکار`,
        body: paragraph(type.description ?? ''),
        raised: true,
      }),
    ];
  });
  return cards.length > 0 ? `<div class="grid grid--3">${cards.join('')}</div>` : '';
}

function industryChips(rows: readonly IndustryFacetRow[]): Facet[] {
  return rows.flatMap((row): Facet[] => {
    const href = industryUrl(row.path);
    return href ? [{ label: row.name_fa, href, count: row.business_count }] : [];
  });
}

function cityChips(rows: readonly LocationFacetRow[]): Facet[] {
  return rows.flatMap((row): Facet[] => {
    const href = locationUrl(row.path);
    return href ? [{ label: row.name_fa, href, count: row.business_count }] : [];
  });
}

/**
 * صفحهٔ اصلی.
 *
 * **دو لایه، یک خروجی.** اگر صفحهٔ `home` در `design.page` منتشر شده باشد،
 * همان درخت رندر می‌شود؛ وگرنه چیدمان پایهٔ کد می‌آید. هر دو لایه دادهٔ
 * ساخت‌یافته، هد سئو و پوستهٔ یکسانی دارند — پس سئو به «کدام لایه رندر شد»
 * گره نمی‌خورد.
 */
export async function homePage(context: PageContext): Promise<PageResponse> {
  const { chrome, config, site, url, settings, requestId } = context;
  const origin = config.env.origins.public;
  const locale = settings?.default_locale ?? 'fa-IR';

  /*
   * سه خواندن موازی؛ هر بخش فقط وقتی دارد که داده دارد. فقط آنچه واقعاً کسب‌وکار
   * دارد نشان داده می‌شود: ردیف خالی در صفحهٔ اصلی، ادعای بی‌پشتوانه است (§186).
   */
  const [allTypes, allIndustries, topCities] = await Promise.all([
    context.data.businessTypes(requestId),
    context.data.industryChildren(null, requestId),
    context.data.facetCities({}, SCENE_LIMIT, requestId),
  ]);
  const populatedTypes = allTypes.filter((type) => type.business_count > 0).sort((a, b) => b.business_count - a.business_count).slice(0, SCENE_LIMIT);
  const populatedIndustries = allIndustries.filter((row) => row.business_count > 0).slice(0, SCENE_LIMIT);

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
    `<section class="hero hero--cinema" id="hero" aria-labelledby="hero-title"><div class="container hero__inner">` +
    `<p class="hero__eyebrow rv">${escapeText(PLATFORM_TAGLINE)}</p>` +
    `<h1 class="hero__title rv" id="hero-title">${escapeText(`${PLATFORM_NAME}؛ جایی که کسب‌وکارهای این صنعت هم‌دیگر را پیدا می‌کنند`)}</h1>` +
    `<p class="hero__lead rv">${escapeText('فهرست زندهٔ کسب‌وکارها، ظرفیت‌ها و خدمات صنعت حیوانات خانگی و اسب؛ با اطلاعاتی که خودِ کسب‌وکار منتشر کرده و ساختاری که مقایسه را ممکن می‌کند.')}</p>` +
    `<div class="hero__actions cluster rv">` +
    `<a class="button button--accent" href="/businesses">${escapeText('دیدن کسب‌وکارها')}</a>` +
    `<a class="button button--ghost" href="/search">${escapeText('جست‌وجو')}</a>` +
    `</div>` +
    `<a class="hero__cue" href="#stats" aria-label="${escapeAttr('ادامهٔ صفحه: عددهای پلتفرم')}"><span aria-hidden="true">↓</span></a>` +
    `</div></section>`;

  const statsScene = scene({
    id: 'stats',
    eyebrow: 'عددها',
    title: 'عددها، از خودِ داده‌ها',
    body:
      `<div class="stat-strip">` +
      [
        metric('کسب‌وکار فعال', chrome.stats.businesses),
        metric('شهر', chrome.stats.cities),
        metric('صنف', chrome.stats.industries),
        metric('نوع کسب‌وکار', chrome.stats.business_types),
      ].join('') +
      `</div>` +
      paragraph('این عددها با هر درخواست از پایگاه‌داده خوانده می‌شوند؛ نه تصویر ثابت‌اند و نه دستی به‌روز می‌شوند.', 'field__hint'),
  });

  const typesScene =
    populatedTypes.length > 0
      ? scene({
          id: 'types',
          tone: 'subtle',
          eyebrow: 'انواع کسب‌وکار',
          title: 'از کلینیک تا دامداری، هر نوع فهرست خودش را دارد',
          lead: 'نوع کسب‌وکار را انتخاب کنید تا شهرها و پروفایل‌های همان نوع را ببینید.',
          body: typeCards(populatedTypes) + `<p class="section--tight"><a class="button button--ghost" href="/t">همهٔ انواع کسب‌وکار</a></p>`,
        })
      : null;

  const industriesScene =
    populatedIndustries.length > 0
      ? scene({
          id: 'industries',
          eyebrow: 'صنف‌ها',
          title: 'بر اساس آنچه انجام می‌دهند',
          lead: 'هر حوزه زیرشاخه‌های خودش را دارد؛ از کلی به جزئی بروید.',
          body: facetChips(industryChips(populatedIndustries)) + `<p class="section--tight"><a class="button button--ghost" href="/i">همهٔ صنف‌ها</a></p>`,
        })
      : null;

  const citiesScene =
    topCities.length > 0
      ? scene({
          id: 'cities',
          tone: 'dark',
          eyebrow: 'شهرها',
          title: 'نزدیک به شما',
          lead: 'شهرهایی که کسب‌وکار فعال دارند، به ترتیب تعداد.',
          body: facetChips(cityChips(topCities)) + `<p class="section--tight"><a class="button button--ghost" href="/l">همهٔ شهرها و استان‌ها</a></p>`,
        })
      : null;

  const featuredScene = scene({
    id: 'businesses',
    eyebrow: 'کسب‌وکارها',
    title: 'کسب‌وکارهای حاضر',
    body:
      chrome.featured.length > 0
        ? `<div class="grid grid--3">` +
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
          `<p class="section--tight"><a class="button button--ghost" href="/businesses">دیدن فهرست</a></p>`,
  });

  const contentScene =
    chrome.contents.length > 0
      ? scene({
          id: 'latest',
          tone: 'subtle',
          eyebrow: 'محتوا',
          title: 'تازه‌ها',
          body:
            `<div class="grid grid--2">` +
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
            `</div>` +
            `<p class="section--tight"><a class="button button--ghost" href="/k">دسته‌های محتوا</a></p>`,
        })
      : null;

  const closingScene =
    `<section class="section scene scene--dark scene--closing" id="start" aria-labelledby="start-title"><div class="container rv">` +
    `<h2 class="section-head__title" id="start-title">${escapeText('هر کسب‌وکار، یک صفحهٔ معتبر')}</h2>` +
    `<p class="section-head__lead">${escapeText('پروفایل عمومی، تصمیم خودِ کسب‌وکار است: چه چیزی دیده شود، چه چیزی نه.')}</p>` +
    `<p class="cluster section--tight"><a class="button button--accent" href="/businesses">${escapeText('مرور کسب‌وکارها')}</a>` +
    `<a class="button button--ghost" href="/rules">${escapeText('قوانین پلتفرم')}</a></p>` +
    `</div></section>`;

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

  const baseline = [
    `<div class="scroll-progress" aria-hidden="true"></div>`,
    hero,
    statsScene,
    typesScene,
    industriesScene,
    citiesScene,
    featuredScene,
    contentScene,
    closingScene,
  ]
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
        : `<section class="section section--tight">${container(
            heading(1, `${PLATFORM_NAME}؛ ${PLATFORM_TAGLINE}`) +
              paragraph('فهرست زندهٔ کسب‌وکارهای صنعت حیوانات خانگی و اسب.', 'ds-text ds-text--lg'),
          )}</section>` + (design.html ?? '')
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
