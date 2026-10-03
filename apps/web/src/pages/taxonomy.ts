/**
 * صفحه‌های تاکسونومی (گام ۲۵؛ §19–۲۰، §22، §25، Addendum §۳۹–۴۷).
 *
 * چهار خانواده، هر کدام یک «مرکز» و یک «صفحهٔ فرود»:
 *
 *   /t  ⇒ /t/{type}              نوع کسب‌وکار («کلینیک دامپزشکی»)
 *   /i  ⇒ /i/{a}/{b}             صنف (سلسله‌مراتبی)
 *   /l  ⇒ /l/{province}/{city}   مکان
 *   /k  ⇒ /k/{a}/{b}             دستهٔ محتوا
 *
 * این صفحه‌ها دو کار می‌کنند و هر دو از داده می‌آید، نه از متن ثابت:
 *
 *   ۱) **راه ورود** به پروفایل‌ها برای کسی که نام کسب‌وکار را نمی‌داند. «کلینیک
 *      دامپزشکی در کرج» جست‌وجوی واقعی است و این صفحه‌ها جوابش‌اند.
 *   ۲) **گراف پیوند داخلی.** هر صفحه به صفحه‌های هم‌خانواده و هم‌ارز پیوند
 *      می‌دهد (نوع ⇄ شهر، صنف ⇄ شهر، دسته ⇄ دسته)، پس هیچ پروفایلی یتیم
 *      نمی‌ماند (Addendum §۴۶: Internal Linking، Orphan Detection).
 *
 * **ایمنی در برابر محتوای کم‌مایه.** صفحهٔ بی‌کسب‌وکار ساخته می‌شود (کاربر نباید
 * به ۴۰۴ بخورد) ولی `noindex, follow` است. تعداد، همیشه از پایگاه‌داده است؛
 * هیچ عددی دستی نوشته نشده است.
 *
 * شمارنده‌ها **کل زیردرخت** را می‌شمارند: صنف والد، کسب‌وکارهای زیرصنف‌هایش
 * را هم دارد؛ وگرنه صفحهٔ «مراقبت و نگه‌داری» خالی دیده می‌شد، در حالی که
 * همهٔ کسب‌وکارها زیر «پانسیون» و «آرایش» نشسته‌اند.
 */

import { clampDescription } from '@petavu/seo';

import { card, emptyState, formatNumber, paragraph } from '../components.js';
import { PLATFORM_NAME } from '../chrome.js';
import type { CategoryContentRow, CategoryFacetRow, IndustryFacetRow, LocationFacetRow, TypeFacetRow } from '../data.js';
import { escapeAttr, escapeText } from '../html.js';
import { itemListNode } from '../structured.js';
import { categoryUrl, industryUrl, locationUrl, typeUrl, type TaxonomyFamily } from '../taxonomy.js';
import {
  PAGE_SIZE,
  businessGrid,
  emptyListing,
  facetChips,
  facetSection,
  paginationNav,
  renderLanding,
  type Facet,
} from './landing.js';
import { notFoundPage } from './system.js';
import type { PageContext, PageResponse } from './types.js';

const CONTENT_KIND_LABEL: Readonly<Record<string, string>> = {
  article: 'مقاله',
  guide: 'راهنما',
  faq: 'پرسش‌های متداول',
  page: 'صفحه',
  service: 'خدمت',
  announcement: 'اعلان',
  event: 'رویداد',
  listing: 'آگهی',
  product: 'محصول',
};

/** شمار، به زبان کاربر؛ صفر، «هنوز» است نه «۰». */
function countLabel(count: number, noun: string): string {
  return count > 0 ? `${formatNumber(count)} ${noun}` : `هنوز ${noun}ی ثبت نشده`;
}

function chipsFor<T>(rows: readonly T[], toFacet: (row: T) => Facet | null): Facet[] {
  return rows.map(toFacet).filter((facet): facet is Facet => facet !== null);
}

function typeFacet(row: TypeFacetRow): Facet | null {
  const href = typeUrl(row.key);
  return href ? { label: row.plural_fa ?? row.name_fa, href, count: row.business_count } : null;
}

function cityFacet(row: LocationFacetRow): Facet | null {
  const href = locationUrl(row.path);
  return href ? { label: row.name_fa, href, count: row.business_count } : null;
}

function industryFacet(row: IndustryFacetRow): Facet | null {
  const href = industryUrl(row.path);
  return href ? { label: row.name_fa, href, count: row.business_count } : null;
}

function categoryFacet(row: CategoryFacetRow): Facet | null {
  const href = categoryUrl(row.path);
  return href ? { label: row.name_fa, href, count: row.content_count } : null;
}

/**
 * بلوک یک گروه در صفحهٔ مرکز: تیتر پیوندی + شمار + تراشه‌های فرزند.
 *
 * کارتِ کاملاً پیوندی این‌جا نمی‌شود چون داخلش پیوند دیگر هست؛ پیوند تودرتو
 * در HTML نامعتبر است و صفحه‌خوان را گیج می‌کند.
 */
function groupBlock(options: { title: string; href: string | null; meta: string; children: readonly Facet[] }): string {
  const title = options.href
    ? `<a href="${escapeAttr(options.href)}">${escapeText(options.title)}</a>`
    : escapeText(options.title);
  return (
    `<article class="card card--raised stack stack--tight">` +
    `<h3 class="card__title">${title}</h3>` +
    `<p class="card__meta">${escapeText(options.meta)}</p>` +
    facetChips(options.children) +
    `</article>`
  );
}

/* ------------------------------------------------------------------ مرکزها */

export async function taxonomyIndexPage(context: PageContext, family: TaxonomyFamily): Promise<PageResponse> {
  const { data, requestId, config } = context;
  const origin = config.env.origins.public;

  switch (family) {
    case 'type': {
      const types = await data.businessTypes(requestId);
      const populated = types.filter((type) => type.business_count > 0);
      // نوع‌هایی که کسب‌وکار دارند اول؛ بقیه به ترتیب تعریف.
      const ordered = [...types].sort((a, b) => Number(b.business_count > 0) - Number(a.business_count > 0));
      const cards = ordered.flatMap((type) => {
        const href = typeUrl(type.key);
        if (!href) return [];
        return [
          card({
            title: type.plural_fa ?? type.name_fa,
            href,
            meta: countLabel(type.business_count, 'کسب‌وکار'),
            body: paragraph(type.description ?? ''),
            raised: true,
          }),
        ];
      });
      return renderLanding({
        context,
        path: '/t',
        entity: { kind: 'listing', id: null, routeKey: '/t', values: { name: 'انواع کسب‌وکار' } },
        fallbackTitle: `انواع کسب‌وکار در صنعت حیوانات خانگی و اسب | ${PLATFORM_NAME}`,
        fallbackDescription: clampDescription(
          `${formatNumber(types.length)} نوع کسب‌وکار در صنعت حیوانات خانگی و اسب، از کلینیک و پت‌شاپ تا دامداری و باشگاه سوارکاری.`,
        ),
        hasSubstance: populated.length > 0,
        crumbs: [{ label: 'انواع کسب‌وکار' }],
        h1: 'انواع کسب‌وکار',
        lead: 'هر نوع کسب‌وکار، فهرست خودش را دارد؛ از آن‌جا به شهرها و پروفایل‌ها برسید.',
        body: cards.length > 0 ? `<div class="grid grid--3 section--tight">${cards.join('')}</div>` : emptyListing('هنوز نوع کسب‌وکاری تعریف نشده است.'),
        nodes:
          populated.length > 0
            ? [
                itemListNode(
                  chipsFor(populated, (type) => {
                    const href = typeUrl(type.key);
                    return href ? { label: type.plural_fa ?? type.name_fa, href } : null;
                  }).map((facet) => ({ name: facet.label, url: facet.href })),
                  { baseUrl: origin, brand: { name: PLATFORM_NAME } },
                ),
              ]
            : [],
        bodyClass: 'page-taxonomy page-taxonomy--type',
      });
    }

    case 'industry': {
      const tree = await data.industryTree(requestId);
      const roots = tree.filter((row) => row.parent_key === null);
      const blocks = roots.flatMap((root) => {
        const children = tree.filter((row) => row.parent_key === root.key);
        const href = industryUrl(root.path);
        return [
          groupBlock({
            title: root.name_fa,
            href,
            meta: countLabel(root.business_count, 'کسب‌وکار'),
            children: chipsFor(children, industryFacet),
          }),
        ];
      });
      return renderLanding({
        context,
        path: '/i',
        entity: { kind: 'listing', id: null, routeKey: '/i', values: { name: 'صنف‌ها' } },
        fallbackTitle: `صنف‌ها و حوزه‌های فعالیت | ${PLATFORM_NAME}`,
        fallbackDescription: clampDescription(
          `کسب‌وکارهای صنعت حیوانات خانگی و اسب بر اساس حوزهٔ فعالیت: ${roots
            .slice(0, 4)
            .map((root) => root.name_fa)
            .join('، ')} و بیشتر.`,
        ),
        hasSubstance: roots.some((root) => root.business_count > 0),
        crumbs: [{ label: 'صنف‌ها' }],
        h1: 'صنف‌ها و حوزه‌های فعالیت',
        lead: 'کسب‌وکارها را بر اساس آنچه انجام می‌دهند بیابید؛ هر حوزه زیرشاخه‌های خودش را دارد.',
        body: blocks.length > 0 ? `<div class="index-grid section--tight">${blocks.join('')}</div>` : emptyListing('هنوز صنفی تعریف نشده است.'),
        bodyClass: 'page-taxonomy page-taxonomy--industry',
      });
    }

    case 'location': {
      const [root, tree] = await Promise.all([data.locationRoot(requestId), data.locationTree(requestId)]);
      const provinces = tree.filter((row) => row.kind === 'province');
      const blocks = provinces.flatMap((province) => {
        const cities = tree.filter((row) => row.parent_id === province.id);
        const href = locationUrl(province.path);
        return [
          groupBlock({
            title: province.name_fa,
            href,
            meta: countLabel(province.business_count, 'کسب‌وکار'),
            children: chipsFor(cities, cityFacet),
          }),
        ];
      });
      const country = root?.name_fa ?? 'ایران';
      return renderLanding({
        context,
        path: '/l',
        entity: { kind: 'listing', id: null, routeKey: '/l', values: { name: 'شهرها و استان‌ها' } },
        fallbackTitle: `کسب‌وکارهای حیوانات خانگی و اسب در ${country}، به تفکیک استان و شهر | ${PLATFORM_NAME}`,
        fallbackDescription: clampDescription(
          `${formatNumber(provinces.length)} استان و ${formatNumber(tree.length - provinces.length)} شهر؛ کسب‌وکارهای صنعت حیوانات خانگی و اسب را در شهر خودتان بیابید.`,
        ),
        hasSubstance: provinces.some((province) => province.business_count > 0),
        crumbs: [{ label: 'شهرها و استان‌ها' }],
        h1: `کسب‌وکارها در ${country}`,
        lead: 'استان یا شهر را انتخاب کنید تا کسب‌وکارهای همان‌جا را ببینید.',
        body: blocks.length > 0 ? `<div class="index-grid section--tight">${blocks.join('')}</div>` : emptyListing('هنوز مکانی تعریف نشده است.'),
        bodyClass: 'page-taxonomy page-taxonomy--location',
      });
    }

    case 'category': {
      const tree = await data.categoryTree(requestId);
      const roots = tree.filter((row) => row.parent_id === null);
      const blocks = roots.flatMap((root) => {
        const children = tree.filter((row) => row.parent_id === root.id);
        return [
          groupBlock({
            title: root.name_fa,
            href: categoryUrl(root.path),
            meta: countLabel(root.content_count, 'محتوا'),
            children: chipsFor(children, categoryFacet),
          }),
        ];
      });
      return renderLanding({
        context,
        path: '/k',
        entity: { kind: 'listing', id: null, routeKey: '/k', values: { name: 'دسته‌های محتوا' } },
        fallbackTitle: `دسته‌های محتوا: مقاله و راهنما | ${PLATFORM_NAME}`,
        fallbackDescription: clampDescription(
          `مقاله‌ها و راهنماهای صنعت حیوانات خانگی و اسب، در دسته‌هایی مثل ${roots
            .slice(0, 4)
            .map((root) => root.name_fa)
            .join('، ')}.`,
        ),
        hasSubstance: roots.some((root) => root.content_count > 0),
        crumbs: [{ label: 'دسته‌های محتوا' }],
        h1: 'دسته‌های محتوا',
        lead: 'مقاله‌ها و راهنماهای منتشرشده، بر اساس موضوع.',
        body: blocks.length > 0 ? `<div class="index-grid section--tight">${blocks.join('')}</div>` : emptyListing('هنوز دسته‌ای تعریف نشده است.'),
        bodyClass: 'page-taxonomy page-taxonomy--category',
      });
    }
  }
}

/* ------------------------------------------------------------------ نوع کسب‌وکار */

export async function businessTypePage(context: PageContext, key: string): Promise<PageResponse> {
  const { data, requestId, url, config } = context;
  const origin = config.env.origins.public;

  const type = await data.businessType(key, requestId);
  if (!type) return notFoundPage(context, { reason: 'type_not_found' });

  const path = typeUrl(type.key);
  if (!path) return notFoundPage(context, { reason: 'type_not_linkable' });

  const cursor = url.searchParams.get('cursor');
  const [page, cities, allTypes, root] = await Promise.all([
    data.listPublicBusinesses({ limit: PAGE_SIZE, cursor, businessTypeKey: key }, requestId),
    data.facetCities({ typeKey: key }, 12, requestId),
    data.businessTypes(requestId),
    data.locationRoot(requestId),
  ]);

  const plural = type.plural_fa ?? type.name_fa;
  const children = allTypes.filter((row) => row.parent_key === key);
  const parent = type.parent_key ? allTypes.find((row) => row.key === type.parent_key) : undefined;
  const parentHref = parent ? typeUrl(parent.key) : null;
  const nextUrl = page.nextCursor ? `${origin}${path}?cursor=${encodeURIComponent(page.nextCursor)}` : null;

  const body =
    facetSection('انواع وابسته', chipsFor(children, typeFacet)) +
    facetSection(`${plural} به تفکیک شهر`, chipsFor(cities, cityFacet), 'cities') +
    (page.items.length > 0
      ? businessGrid(page.items) + (nextUrl ? paginationNav(`${path}?cursor=${encodeURIComponent(page.nextCursor as string)}`) : '')
      : emptyListing(`هنوز ${plural} پروفایل عمومی منتشر نکرده‌اند. به‌محض انتشار، این فهرست پر می‌شود.`));

  return renderLanding({
    context,
    path,
    entity: {
      kind: 'business_type',
      id: null,
      routeKey: path,
      values: {
        name: type.name_fa,
        type: type.name_fa,
        type_plural: plural,
        city: root?.name_fa ?? 'ایران',
        count: type.business_count,
      },
    },
    fallbackTitle: `${plural} | ${PLATFORM_NAME}`,
    fallbackDescription: clampDescription(
      type.business_count > 0
        ? `${formatNumber(type.business_count)} ${type.name_fa} فعال با پروفایل عمومی در ${PLATFORM_NAME}؛ اطلاعات تماس، نشانی و خدمات.`
        : `فهرست ${plural} در ${PLATFORM_NAME}.`,
    ),
    hasSubstance: type.business_count > 0,
    nonIndexableReason: 'no_businesses',
    isFirstPage: !cursor,
    nextUrl,
    crumbs: [
      { label: 'انواع کسب‌وکار', href: '/t' },
      ...(parent && parentHref ? [{ label: parent.plural_fa ?? parent.name_fa, href: parentHref }] : []),
      { label: plural },
    ],
    h1: plural,
    lead: type.description,
    body,
    nodes:
      page.items.length > 0
        ? [
            itemListNode(
              page.items.map((business) => ({ name: business.name, url: `/b/${business.slug}` })),
              { baseUrl: origin, brand: { name: PLATFORM_NAME } },
            ),
          ]
        : [],
    bodyClass: 'page-taxonomy page-type',
    canonicalKeepParams: ['cursor'],
  });
}

/* ------------------------------------------------------------------ صنف */

export async function industryPage(context: PageContext, industryPath: string): Promise<PageResponse> {
  const { data, requestId, url, config } = context;
  const origin = config.env.origins.public;

  const found = await data.industryByPath(industryPath, requestId);
  if (!found) return notFoundPage(context, { reason: 'industry_not_found' });

  const { industry, ancestors } = found;
  const path = industryUrl(industry.path);
  if (!path) return notFoundPage(context, { reason: 'industry_not_linkable' });

  const cursor = url.searchParams.get('cursor');
  const [page, children, cities] = await Promise.all([
    data.listPublicBusinesses({ limit: PAGE_SIZE, cursor, industryPath: industry.path }, requestId),
    data.industryChildren(industry.path, requestId),
    data.facetCities({ industryPath: industry.path }, 12, requestId),
  ]);

  const nextUrl = page.nextCursor ? `${origin}${path}?cursor=${encodeURIComponent(page.nextCursor)}` : null;

  const body =
    facetSection('زیرشاخه‌ها', chipsFor(children, industryFacet)) +
    facetSection('به تفکیک شهر', chipsFor(cities, cityFacet), 'cities') +
    (page.items.length > 0
      ? businessGrid(page.items) + (nextUrl ? paginationNav(`${path}?cursor=${encodeURIComponent(page.nextCursor as string)}`) : '')
      : emptyListing('هنوز کسب‌وکاری در این حوزه پروفایل عمومی منتشر نکرده است.'));

  return renderLanding({
    context,
    path,
    entity: {
      kind: 'industry',
      id: null,
      routeKey: path,
      values: { name: industry.name_fa, industry_name: industry.name_fa, type: 'کسب‌وکار', count: industry.business_count },
    },
    fallbackTitle: `${industry.name_fa} — کسب‌وکارهای این حوزه | ${PLATFORM_NAME}`,
    fallbackDescription: clampDescription(
      industry.business_count > 0
        ? `${formatNumber(industry.business_count)} کسب‌وکار فعال در حوزهٔ ${industry.name_fa}؛ پروفایل، تماس و خدمات.`
        : `حوزهٔ ${industry.name_fa} در ${PLATFORM_NAME}.`,
    ),
    hasSubstance: industry.business_count > 0,
    nonIndexableReason: 'no_businesses',
    isFirstPage: !cursor,
    nextUrl,
    crumbs: [
      { label: 'صنف‌ها', href: '/i' },
      ...chipsFor(ancestors, (row) => {
        const href = industryUrl(row.path);
        return href ? { label: row.name_fa, href } : null;
      }),
      { label: industry.name_fa },
    ],
    h1: industry.name_fa,
    lead: industry.description,
    body,
    nodes:
      page.items.length > 0
        ? [
            itemListNode(
              page.items.map((business) => ({ name: business.name, url: `/b/${business.slug}` })),
              { baseUrl: origin, brand: { name: PLATFORM_NAME } },
            ),
          ]
        : [],
    bodyClass: 'page-taxonomy page-industry',
    canonicalKeepParams: ['cursor'],
  });
}

/* ------------------------------------------------------------------ مکان */

export async function locationPage(context: PageContext, suffix: string): Promise<PageResponse> {
  const { data, requestId, url, config } = context;
  const origin = config.env.origins.public;

  const found = await data.locationBySuffix(suffix, requestId);
  if (!found) return notFoundPage(context, { reason: 'location_not_found' });

  const { location, ancestors } = found;
  const path = locationUrl(location.path);
  if (!path || path === '/l') return notFoundPage(context, { reason: 'location_not_linkable' });

  const cursor = url.searchParams.get('cursor');
  const [page, children, types] = await Promise.all([
    data.listPublicBusinesses({ limit: PAGE_SIZE, cursor, locationPath: location.path }, requestId),
    data.locationChildren(location.id, requestId),
    data.facetTypes({ locationPath: location.path }, 12, requestId),
  ]);

  const nextUrl = page.nextCursor ? `${origin}${path}?cursor=${encodeURIComponent(page.nextCursor)}` : null;
  const isProvince = location.kind === 'province';

  const body =
    (isProvince ? facetSection('شهرها', chipsFor(children, cityFacet)) : '') +
    facetSection('انواع کسب‌وکار در این منطقه', chipsFor(types, typeFacet), 'types') +
    (page.items.length > 0
      ? businessGrid(page.items) + (nextUrl ? paginationNav(`${path}?cursor=${encodeURIComponent(page.nextCursor as string)}`) : '')
      : emptyListing(`هنوز کسب‌وکاری در ${location.name_fa} پروفایل عمومی منتشر نکرده است.`));

  return renderLanding({
    context,
    path,
    entity: {
      kind: 'location',
      id: null,
      routeKey: path,
      values: { name: location.name_fa, city_name: location.name_fa, city: location.name_fa, count: location.business_count },
    },
    fallbackTitle: `کسب‌وکارهای حیوانات خانگی و اسب در ${location.name_fa} | ${PLATFORM_NAME}`,
    fallbackDescription: clampDescription(
      location.business_count > 0
        ? `${formatNumber(location.business_count)} کسب‌وکار فعال صنعت حیوانات خانگی و اسب در ${location.name_fa}.`
        : `کسب‌وکارهای صنعت حیوانات خانگی و اسب در ${location.name_fa}.`,
    ),
    hasSubstance: location.business_count > 0,
    nonIndexableReason: 'no_businesses',
    isFirstPage: !cursor,
    nextUrl,
    crumbs: [
      { label: 'شهرها و استان‌ها', href: '/l' },
      ...chipsFor(
        // ریشهٔ کشور خودش صفحهٔ `/l` است و دوبار نمی‌آید.
        ancestors.filter((row) => row.kind !== 'country'),
        (row) => {
          const href = locationUrl(row.path);
          return href ? { label: row.name_fa, href } : null;
        },
      ),
      { label: location.name_fa },
    ],
    h1: `کسب‌وکارها در ${location.name_fa}`,
    lead: null,
    body,
    nodes:
      page.items.length > 0
        ? [
            itemListNode(
              page.items.map((business) => ({ name: business.name, url: `/b/${business.slug}` })),
              { baseUrl: origin, brand: { name: PLATFORM_NAME } },
            ),
          ]
        : [],
    bodyClass: 'page-taxonomy page-location',
    canonicalKeepParams: ['cursor'],
  });
}

/* ------------------------------------------------------------------ دستهٔ محتوا */

export async function categoryPage(context: PageContext, categoryPath: string): Promise<PageResponse> {
  const { data, requestId, url, config } = context;
  const origin = config.env.origins.public;

  const found = await data.categoryByPath(categoryPath, requestId);
  if (!found) return notFoundPage(context, { reason: 'category_not_found' });

  const { category, ancestors } = found;
  const path = categoryUrl(category.path);
  if (!path) return notFoundPage(context, { reason: 'category_not_linkable' });

  const cursor = url.searchParams.get('cursor');
  const [page, children] = await Promise.all([
    data.contentByCategory({ path: category.path, limit: PAGE_SIZE, cursor }, requestId),
    data.categoryChildren(category.path, requestId),
  ]);

  const nextUrl = page.nextCursor ? `${origin}${path}?cursor=${encodeURIComponent(page.nextCursor)}` : null;

  const cards = page.items.map((item: CategoryContentRow) =>
    card({
      title: item.title,
      // محتوای کسب‌وکار به پروفایل همان کسب‌وکار می‌رود؛ محتوای پلتفرم، به نشانی خودش.
      href: item.business_slug ? `/b/${item.business_slug}` : `/${item.slug}`,
      meta: [CONTENT_KIND_LABEL[item.kind] ?? item.kind, item.business_name].filter(Boolean).join(' — '),
      body: paragraph(item.summary ?? ''),
      raised: true,
    }),
  );

  const body =
    facetSection('زیردسته‌ها', chipsFor(children, categoryFacet)) +
    (cards.length > 0
      ? `<div class="grid grid--3 section--tight">${cards.join('')}</div>` +
        (nextUrl ? paginationNav(`${path}?cursor=${encodeURIComponent(page.nextCursor as string)}`) : '')
      : emptyState('هنوز محتوایی در این دسته منتشر نشده است.'));

  return renderLanding({
    context,
    path,
    entity: {
      kind: 'category',
      id: null,
      routeKey: path,
      values: { name: category.name_fa, category_name: category.name_fa, count: category.content_count },
    },
    fallbackTitle: `${category.name_fa} — مقاله و راهنما | ${PLATFORM_NAME}`,
    fallbackDescription: clampDescription(category.description ?? `مقالات و راهنماهای دستهٔ ${category.name_fa} در ${PLATFORM_NAME}.`),
    hasSubstance: category.content_count > 0,
    nonIndexableReason: 'no_content',
    isFirstPage: !cursor,
    nextUrl,
    crumbs: [
      { label: 'دسته‌های محتوا', href: '/k' },
      ...chipsFor(ancestors, (row) => {
        const href = categoryUrl(row.path);
        return href ? { label: row.name_fa, href } : null;
      }),
      { label: category.name_fa },
    ],
    h1: category.name_fa,
    lead: category.description,
    body,
    nodes:
      page.items.length > 0
        ? [
            itemListNode(
              page.items.map((item) => ({ name: item.title, url: item.business_slug ? `/b/${item.business_slug}` : `/${item.slug}` })),
              { baseUrl: origin, brand: { name: PLATFORM_NAME } },
            ),
          ]
        : [],
    bodyClass: 'page-taxonomy page-category',
    canonicalKeepParams: ['cursor'],
  });
}
