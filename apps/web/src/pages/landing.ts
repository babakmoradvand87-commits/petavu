/**
 * ساختار مشترک صفحه‌های «فهرست» (گام ۲۵؛ §19–۲۰، §25، §39، Addendum §۴۴–۴۶).
 *
 * نوع کسب‌وکار، صنف، مکان، دستهٔ محتوا و جست‌وجو پنج صفحه‌اند با یک ساختار:
 * مسیر راهنما، عنوان، یک بدنه، و هد سئو. اگر هر صفحه سازندهٔ خودش را داشت،
 * پنج جا برای فراموش‌کردن `noindex` یا JSON-LD وجود داشت. این‌جا یک جاست.
 *
 * **سیاست محتوای کم‌مایه** (Addendum §۴۴ و §۴۶: «صفحه‌ای که ارزش افزوده ندارد،
 * ایندکس نمی‌شود») این‌جا اعمال می‌شود، نه در هر صفحه: هر صفحه فقط می‌گوید
 * «آیا چیزی برای نشان‌دادن دارم؟» (`indexable`) و این سازنده تصمیم می‌گیرد.
 * فهرستِ خالی ۲۰۰ می‌دهد (کاربر باید راهنمایی شود، نه ۴۰۴ بخورد) ولی
 * `noindex, follow` می‌گیرد.
 */

import type { JsonLdNode } from '@petavu/seo';

import { badge, breadcrumb, card, container, emptyState, formatNumber, heading, paragraph, section } from '../components.js';
import { PLATFORM_NAME, renderShell, verificationBadge } from '../chrome.js';
import type { PublicBusinessRow } from '../data.js';
import { escapeAttr, escapeText } from '../html.js';
import { buildPageHead, type HeadEntity } from '../seohead.js';
import { breadcrumbList, jsonLdBlocks } from '../structured.js';
import type { PageContext, PageResponse } from './types.js';

export const PAGE_SIZE = 24;

export interface Crumb {
  readonly label: string;
  readonly href?: string;
}

export interface Facet {
  readonly label: string;
  readonly href: string;
  readonly count?: number | null;
}

export interface LandingInput {
  readonly context: PageContext;
  /** مسیر کانونیک صفحه، بدون کوئری. */
  readonly path: string;
  readonly entity: HeadEntity;
  readonly fallbackTitle: string;
  readonly fallbackDescription: string;
  /** «آیا این صفحه محتوای واقعی دارد؟» — خالی بودن، نمایه‌شدن را می‌بندد. */
  readonly hasSubstance: boolean;
  readonly nonIndexableReason?: string | null;
  /** صفحهٔ اول فهرست؟ صفحه‌های بعدی `noindex, follow` می‌گیرند. */
  readonly isFirstPage?: boolean;
  /** نشانی مطلق صفحهٔ بعد، برای `rel=next`. */
  readonly nextUrl?: string | null;
  readonly crumbs: readonly Crumb[];
  readonly h1: string;
  readonly lead?: string | null;
  /** بدنهٔ آمادهٔ HTML (بخش‌های سازندهٔ صفحه). */
  readonly body: string;
  readonly nodes?: readonly JsonLdNode[];
  readonly bodyClass: string;
  readonly canonicalKeepParams?: readonly string[];
}

export async function renderLanding(input: LandingInput): Promise<PageResponse> {
  const { context } = input;
  const { config, site, url, settings } = context;
  const origin = config.env.origins.public;
  const locale = settings?.default_locale ?? 'fa-IR';
  const isFirstPage = input.isFirstPage ?? true;

  // پیوندهای دستیِ همین صفحه، موازی با هد (هر دو فقط خواندن‌اند).
  const editorialLinks = await context.data.internalLinks(input.path, context.requestId);

  const head = await buildPageHead({
    context,
    site,
    path: input.path,
    search: url.searchParams,
    /*
     * `title` و `description` پیش‌فرض‌اند تا قالب عمومی فهرست (`{title}`،
     * `{description}`) هرگز با توکن تهی رندر نشود؛ صفحه می‌تواند بازنویسی‌شان کند.
     */
    entity: { ...input.entity, values: { title: input.h1, description: input.fallbackDescription, ...input.entity.values } },
    fallbackTitle: input.fallbackTitle,
    fallbackDescription: input.fallbackDescription,
    indexable: site.indexable && isFirstPage && input.hasSubstance,
    nonIndexableReason: !input.hasSubstance ? (input.nonIndexableReason ?? 'thin_content') : isFirstPage ? null : 'paginated',
    extraDirectives: isFirstPage ? [] : ['noindex', 'follow'],
    canonicalKeepParams: input.canonicalKeepParams ?? [],
    pagination: { next: input.nextUrl ?? null },
    og: { type: 'website' },
  });

  const crumbNodes = [
    { name: 'خانه', url: '/' },
    ...input.crumbs.map((crumb, index) => ({
      name: crumb.label,
      // آخرین حلقه، خود صفحه است؛ بقیه باید نشانی داشته باشند.
      url: index === input.crumbs.length - 1 ? input.path : (crumb.href ?? input.path),
    })),
  ];

  const lead = input.lead ? paragraph(input.lead, 'ds-text ds-text--lg') : '';

  const content = [
    section({
      tight: true,
      children: container(breadcrumb([{ label: 'خانه', href: '/' }, ...input.crumbs])),
    }),
    section({
      children: container(heading(1, input.h1) + lead + input.body + editorialSection(editorialLinks)),
    }),
  ].join('\n');

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
    content,
    jsonLd: jsonLdBlocks({
      baseUrl: origin,
      brandName: PLATFORM_NAME,
      locale,
      nodes: [
        breadcrumbList(crumbNodes, { baseUrl: origin, brandName: PLATFORM_NAME }),
        ...(input.nodes ?? []),
        ...head.structuredNodes,
      ],
    }),
    bodyClass: input.bodyClass,
  });

  return { status: 200, kind: 'html', body: html };
}

/* ------------------------------------------------------------------ اجزای مشترک */

/** کارت‌های کسب‌وکار؛ نام فارسی نوع، نه کلید خام. */
export function businessGrid(items: readonly PublicBusinessRow[]): string {
  if (items.length === 0) return '';
  const cards = items.map((business) =>
    card({
      title: business.name,
      href: `/b/${business.slug}`,
      meta: [business.tagline, business.city_name].filter(Boolean).join(' — ') || undefined,
      raised: true,
      body:
        paragraph(business.summary ?? 'اطلاعات این کسب‌وکار در پروفایل عمومی‌اش آمده است.') +
        `<div class="cluster">${verificationBadge(business.verification_level) ?? ''}${badge(business.type_name ?? business.business_type_key)}</div>`,
    }),
  );
  return `<div class="grid grid--3 section--tight">${cards.join('')}</div>`;
}

export function paginationNav(nextHref: string): string {
  return (
    `<nav class="cluster cluster--between section--tight" aria-label="صفحه‌بندی">` +
    `<a class="button button--ghost" rel="next" href="${escapeAttr(nextHref)}">صفحهٔ بعد</a>` +
    `<span class="field__hint">${escapeText('فهرست با نشانگر پیمایش می‌شود؛ موردی از قلم نمی‌افتد.')}</span>` +
    `</nav>`
  );
}

/** تراشه‌های پیوندی (لمس ۴۴ پیکسل)؛ شمارنده فقط وقتی داده دارد. */
export function facetChips(items: readonly Facet[]): string {
  if (items.length === 0) return '';
  const entries = items.map(
    (item) =>
      `<li><a class="chip" href="${escapeAttr(item.href)}">${escapeText(item.label)}` +
      (typeof item.count === 'number' ? ` <span class="chip__count">${escapeText(formatNumber(item.count))}</span>` : '') +
      `</a></li>`,
  );
  return `<ul class="chips" role="list">${entries.join('')}</ul>`;
}

/** یک بخش با تیتر و تراشه‌ها؛ خالی ⇒ هیچ (بخش خالی، صادق‌تر از بخش پُرِ جعلی است). */
export function facetSection(title: string, items: readonly Facet[], id?: string): string {
  if (items.length === 0) return '';
  return `<div class="section--tight stack"${id ? ` id="${escapeAttr(id)}"` : ''}>${heading(2, title, { class: 'ds-heading ds-heading--sm' })}${facetChips(items)}</div>`;
}

export function emptyListing(text: string): string {
  return emptyState(text);
}

/**
 * پیوندهای دستیِ سراسری (`seo.internal_link`) برای یک صفحه (§۳۹–۴۷: Internal Linking).
 *
 * مقدار پایگاه‌داده **اعتماد نمی‌شود**: فقط مسیر داخلی (`/…` و نه `//…`)، بی‌فاصله. نشانی
 * مطلق، `javascript:` و هر چیز دیگر دور ریخته می‌شود؛ پیوند داخلی قرار است داخل بماند.
 */
export function editorialChips(links: ReadonlyArray<{ target_path: string; anchor_text: string | null }>): Facet[] {
  return links
    .filter((link) => link.target_path === '/' || /^\/[^\s/][^\s]*$/.test(link.target_path))
    .map((link) => ({ label: link.anchor_text ?? link.target_path, href: link.target_path }));
}

export function editorialSection(links: ReadonlyArray<{ target_path: string; anchor_text: string | null }>): string {
  return facetSection('پیوندهای مرتبط', editorialChips(links), 'links');
}
