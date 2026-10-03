/**
 * دادهٔ ساخت‌یافته (گام ۲۲؛ Addendum §۴۱–۴۳، §GEO).
 *
 * قاعده‌ای که این ماژول را کوتاه نگه می‌دارد: **گراف را `@petavu/seo` می‌سازد.**
 * این‌جا فقط سه کار انجام می‌شود: انتخاب گره‌های مخصوص صفحه، مطلق‌کردن نشانی‌ها،
 * و برگرداندن بلوک‌های آمادهٔ درج. اگر روزی شکل گراف عوض شود، یک جا عوض می‌شود.
 *
 * نهاد برند، مرکز گراف است (Addendum §GEO): هر صفحه دست‌کم یک گره برند دارد،
 * تا موتور و مدل زبانی بفهمد این صفحه به کدام موجودیت تعلق دارد.
 */

import {
  articleNode,
  breadcrumbNode,
  buildGraph,
  faqNode,
  itemListNode,
  localBusinessNode,
  serializeJsonLd,
  type GraphOptions,
  type JsonLdNode,
} from '@petavu/seo';

export interface GraphInput {
  readonly baseUrl: string;
  readonly brandName: string;
  readonly brandUrl?: string;
  readonly brandLogo?: string | null;
  readonly locale?: string;
  readonly nodes: readonly JsonLdNode[];
}

/** بلوک‌های آمادهٔ `<script type="application/ld+json">` (از قبل امن‌شده). */
export function jsonLdBlocks(input: GraphInput): string[] {
  if (input.nodes.length === 0) return [];

  const options: GraphOptions = {
    baseUrl: input.baseUrl,
    brand: {
      name: input.brandName,
      url: input.brandUrl ?? input.baseUrl,
      logo: input.brandLogo ?? null,
    },
    locale: input.locale ?? 'fa-IR',
  };

  // `buildGraph` همیشه گره‌های Organization و WebSite را اول می‌گذارد.
  return [serializeJsonLd(buildGraph(input.nodes, options))];
}

export function breadcrumbList(
  items: ReadonlyArray<{ name: string; url: string }>,
  options: { baseUrl: string; brandName: string },
): JsonLdNode {
  return breadcrumbNode(items, {
    baseUrl: options.baseUrl,
    brand: { name: options.brandName },
  });
}

export interface BusinessGraphInput {
  readonly baseUrl: string;
  readonly brandName: string;
  readonly business: {
    name: string;
    slug: string;
    summary: string | null;
    tagline: string | null;
    city: string | null;
    countryCode: string | null;
    logoUrl?: string | null;
    telephone?: string | null;
  };
}

/**
 * گرهٔ کسب‌وکار.
 *
 * `@type` عمداً رایج‌ترین نوع (`LocalBusiness`) است و نه نوع دقیق صنفی: نوع
 * ناموجود یا اشتباه، برای موتور بدتر از نوع عام است. تخصصی‌کردن نوع، وقتی
 * می‌آید که `ref.business_type` نگاشت رسمی داشته باشد.
 */
export function businessNode(input: BusinessGraphInput): JsonLdNode {
  return localBusinessNode(
    {
      name: input.business.name,
      url: `/b/${input.business.slug}`,
      description: input.business.summary ?? input.business.tagline ?? undefined,
      telephone: input.business.telephone ?? undefined,
      image: input.business.logoUrl ?? undefined,
      address: { city: input.business.city ?? undefined, country: input.business.countryCode ?? 'IR' },
    },
    {
      baseUrl: input.baseUrl,
      brand: { name: input.brandName },
    },
  );
}

export { articleNode, faqNode, itemListNode };
