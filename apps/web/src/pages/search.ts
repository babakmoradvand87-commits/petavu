/**
 * صفحهٔ جست‌وجو (گام ۲۵؛ §57–۶۳، Addendum §۳۶–۳۸، §۴۴).
 *
 * سه تصمیم، هر کدام با دلیل:
 *
 *   ۱) **نتیجه از سرور می‌آید** و با فرم ساده (GET) کار می‌کند؛ بدون JavaScript.
 *      بودجهٔ `/search` می‌گوید «نتیجهٔ اول باید از سرور بیاید» (گام ۱۴).
 *   ۲) **همیشه `noindex, follow`.** نتیجهٔ جست‌وجوی آزاد، بی‌نهایت نشانی تولید
 *      می‌کند و هیچ‌کدام ارزش مستقل ندارد؛ نمایه‌شدنش محتوای کم‌مایه است
 *      (Addendum §۴۴). پیوندها دنبال می‌شوند، چون به پروفایل‌ها می‌رسند.
 *   ۳) **بی‌نتیجه، بن‌بست نیست.** کاربر به انواع کسب‌وکار و شهرها هدایت می‌شود؛
 *      همان مسیرهایی که خودشان فهرست واقعی دارند.
 *
 * ورودی هرگز اعتماد نمی‌شود: کوتاه (۸۰ نویسه) می‌شود، در `<title>` و ویژگی‌ها
 * escape می‌شود، و به پایگاه‌داده فقط **پارامتر** می‌رسد (§52).
 */

import { clampDescription } from '@petavu/seo';

import { badge, card, formatNumber, heading, paragraph } from '../components.js';
import { PLATFORM_NAME, verificationBadge } from '../chrome.js';
import { escapeAttr, escapeText } from '../html.js';
import { locationUrl, typeUrl } from '../taxonomy.js';
import { facetSection, renderLanding, type Facet } from './landing.js';
import type { PageContext, PageResponse } from './types.js';

export const MAX_QUERY_LENGTH = 80;
export const MIN_QUERY_LENGTH = 2;
const RESULT_LIMIT = 24;

/** فرم جست‌وجو؛ دسترس‌پذیر (label واقعی، `role=search`) و بی‌JavaScript. */
export function searchForm(value: string, options: { id?: string } = {}): string {
  const id = options.id ?? 'q';
  return (
    `<form class="search-form" role="search" method="get" action="/search">` +
    `<div class="field">` +
    `<label class="field__label" for="${escapeAttr(id)}">عبارت جست‌وجو</label>` +
    `<input class="input" id="${escapeAttr(id)}" name="q" type="search" value="${escapeAttr(value)}" ` +
    `autocomplete="off" enterkeyhint="search" minlength="${MIN_QUERY_LENGTH}" maxlength="${MAX_QUERY_LENGTH}" required>` +
    `<span class="field__hint">${escapeText('نام کسب‌وکار، نوع، صنف یا شهر؛ مثلاً «کلینیک کرج».')}</span>` +
    `</div>` +
    `<button class="button button--primary" type="submit">جست‌وجو</button>` +
    `</form>`
  );
}

/** پیشنهادهای بن‌بست‌شکن؛ فقط آنچه واقعاً کسب‌وکار دارد. */
async function suggestions(context: PageContext): Promise<string> {
  const { data, requestId } = context;
  const [types, cities] = await Promise.all([data.businessTypes(requestId), data.facetCities({}, 8, requestId)]);

  const typeFacets = types
    .filter((type) => type.business_count > 0)
    .slice(0, 8)
    .flatMap((type): Facet[] => {
      const href = typeUrl(type.key);
      return href ? [{ label: type.plural_fa ?? type.name_fa, href, count: type.business_count }] : [];
    });
  const cityFacets = cities.flatMap((city): Facet[] => {
    const href = locationUrl(city.path);
    return href ? [{ label: city.name_fa, href, count: city.business_count }] : [];
  });

  const browse =
    `<p class="cluster">` +
    `<a class="button button--ghost" href="/t">همهٔ انواع کسب‌وکار</a>` +
    `<a class="button button--ghost" href="/l">همهٔ شهرها</a>` +
    `<a class="button button--ghost" href="/businesses">فهرست کسب‌وکارها</a>` +
    `</p>`;

  return facetSection('انواع کسب‌وکار', typeFacets) + facetSection('شهرها', cityFacets) + browse;
}

export async function searchPage(context: PageContext): Promise<PageResponse> {
  const { data, requestId, url } = context;

  const query = (url.searchParams.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  const searchable = query.length >= MIN_QUERY_LENGTH;
  const hits = searchable ? await data.searchBusinesses(query, RESULT_LIMIT, requestId) : [];

  let body = searchForm(query);

  if (!searchable) {
    body +=
      (query.length > 0 ? paragraph('عبارت جست‌وجو باید دست‌کم دو نویسه باشد.', 'field__hint') : '') +
      (await suggestions(context));
  } else if (hits.length > 0) {
    const cards = hits.map((hit) =>
      card({
        title: hit.name,
        href: `/b/${hit.slug}`,
        meta: [hit.tagline, hit.city_name].filter(Boolean).join(' — ') || undefined,
        raised: true,
        body:
          paragraph(hit.summary ?? 'اطلاعات این کسب‌وکار در پروفایل عمومی‌اش آمده است.') +
          `<div class="cluster">${verificationBadge(hit.verification_level) ?? ''}${badge(hit.type_name ?? hit.business_type_key)}</div>`,
      }),
    );
    body +=
      `<div class="section--tight stack" aria-live="polite">` +
      heading(2, `${formatNumber(hits.length)} نتیجه برای «${query}»`, { class: 'ds-heading ds-heading--sm' }) +
      `</div>` +
      `<div class="grid grid--3 section--tight">${cards.join('')}</div>` +
      (hits.length >= RESULT_LIMIT ? paragraph('بهترین نتیجه‌ها نشان داده شد؛ برای دقیق‌تر شدن، عبارت را کامل‌تر بنویسید.', 'field__hint') : '');
  } else {
    body +=
      `<div class="section--tight stack" aria-live="polite">` +
      heading(2, `برای «${query}» نتیجه‌ای پیدا نشد`, { class: 'ds-heading ds-heading--sm' }) +
      paragraph('نوشتار را کوتاه‌تر کنید، یا از انواع کسب‌وکار و شهرها وارد شوید.') +
      `</div>` +
      (await suggestions(context));
  }

  return renderLanding({
    context,
    path: '/search',
    /*
     * قالب «جست‌وجو: {query}» فقط وقتی معنا دارد که پرس‌وجویی هست. صفحهٔ خالیِ
     * جست‌وجو یک «فهرست» است (بدون عبارت)؛ پس قالب فهرست را می‌گیرد، نه عنوانی
     * با جای خالی.
     */
    entity: {
      kind: searchable ? 'search' : 'listing',
      id: null,
      routeKey: '/search',
      values: { query, name: 'جست‌وجو', title: 'جست‌وجو در کسب‌وکارها' },
    },
    fallbackTitle: searchable ? `جست‌وجوی «${query}» | ${PLATFORM_NAME}` : `جست‌وجو در کسب‌وکارها | ${PLATFORM_NAME}`,
    fallbackDescription: clampDescription(
      searchable
        ? `نتایج جست‌وجوی «${query}» در کسب‌وکارهای ${PLATFORM_NAME}.`
        : `جست‌وجو در کسب‌وکارهای صنعت حیوانات خانگی و اسب بر اساس نام، نوع، صنف و شهر.`,
    ),
    // نتیجهٔ جست‌وجوی آزاد، همیشه کم‌مایه است (Addendum §۴۴).
    hasSubstance: false,
    nonIndexableReason: 'search_results',
    crumbs: [{ label: 'جست‌وجو' }],
    h1: 'جست‌وجو در کسب‌وکارها',
    lead: null,
    body,
    bodyClass: 'page-search',
  });
}
