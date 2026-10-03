/**
 * Repository دادهٔ مرجع (§19–۲۰): نوع کسب‌وکار، صنعت، مکان، دسته.
 *
 * این داده، **قابل‌افزودن بدون استقرار کد** است (§19). پس Repository آن فقط
 * خواندن دارد: هر نوشتنی از پنل مدیریت و با مجوز پلتفرمی انجام می‌شود، نه از
 * این مسیر. اگر بنویسی‌شد، هر ماژول می‌توانست تاکسونومی را عوض کند.
 *
 * یک نکتهٔ کش: این درخت‌ها کم‌تغییرند و در هر درخواست لازم‌اند؛ پس `updatedAt`
 * را هم برمی‌گردانیم تا لایهٔ کش بالاتر بداند چه زمانی تازه‌سازی کند.
 */

import { sql } from '../sql.js';
import { PAGE } from './support.js';
import type { Row } from '../types.js';
import type { RepoDeps } from './support.js';

/** یک نتیجهٔ جست‌وجوی عمومی (خروجی `app.search_businesses`). */
export interface SearchHit extends Row {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly tagline: string | null;
  readonly summary: string | null;
  readonly business_type_key: string;
  readonly type_name: string | null;
  readonly industry_key: string | null;
  readonly verification_level: string;
  readonly city_slug: string | null;
  readonly city_name: string | null;
  readonly score: number;
}

export function catalogRepository(deps: RepoDeps) {
  const { dal } = deps;

  return {
    /**
     * انواع کسب‌وکار، به‌صورت درخت.
     *
     * درخت در کد ساخته می‌شود نه با `WITH RECURSIVE`: عمق این تاکسونومی دو
     * سطح است و پرس‌وجوی بازگشتی برای دو سطح، پیچیدگی بی‌فایده است. اگر روزی
     * عمق بیشتر شد، همین تابع یک جا عوض می‌شود.
     */
    async businessTypes(options: { includeInactive?: boolean } = {}): Promise<Row[]> {
      const filters = options.includeInactive ? sql`true` : sql`t.is_active`;
      const rows = await dal.query<Row>(
        sql`select t.key, t.parent_key, t.name_fa, t.plural_fa, t.description, t.depth, t.schema_type,
                   t.icon_key, t.sort_order, t.is_active, t.updated_at
            from ref.business_type t
            where ${filters}
            order by t.depth asc, t.sort_order asc, t.key asc`,
      );
      return rows;
    },

    async businessType(key: string): Promise<Row | null> {
      return dal.maybeOne(
        sql`select t.key, t.parent_key, t.name_fa, t.plural_fa, t.description, t.depth, t.schema_type,
                   t.icon_key, t.sort_order, t.is_active
            from ref.business_type t where t.key = ${key}`,
      );
    },

    async industries(options: { includeInactive?: boolean } = {}): Promise<Row[]> {
      const filters = options.includeInactive ? sql`true` : sql`i.is_active`;
      return dal.query(
        sql`select i.key, i.parent_key, i.name_fa, i.description, i.sort_order, i.is_active
            from ref.industry i
            where ${filters}
            order by i.sort_order asc, i.key asc`,
      );
    },

    /** مکان‌ها با فیلتر والد و سطح؛ برای انتخاب‌گر آبشاری و مسیرهای مکانی سئو. */
    async locations(options: { parentId?: string | null; kind?: string; limit?: number } = {}): Promise<Row[]> {
      const filters = [sql`l.is_active`];
      if (options.parentId === null) filters.push(sql`l.parent_id is null`);
      else if (options.parentId) filters.push(sql`l.parent_id = ${options.parentId}`);
      if (options.kind) filters.push(sql`l.kind = ${options.kind}`);
      const where = filters.reduce((acc, filter) => sql`${acc} and ${filter}`);
      return dal.query(
        sql`select l.id, l.parent_id, l.kind, l.name_fa, l.slug, l.path, l.latitude, l.longitude, l.is_active
            from ref.location l where ${where}
            order by l.name_fa asc
            limit ${Math.min(Number(options.limit ?? 200), 500)}`,
      );
    },

    async locationBySlug(slug: string): Promise<Row | null> {
      return dal.maybeOne(
        sql`select l.id, l.parent_id, l.kind, l.name_fa, l.slug, l.latitude, l.longitude
            from ref.location l where l.slug = ${slug}`,
      );
    },

    /**
     * دسته‌بندی‌ها — درختی با `parent_id` و مسیر مادیت‌شده.
     *
     * `scope` تعیین می‌کند دسته‌بندی سراسری است یا مخصوص یک کسب‌وکار؛ فیلتر
     * صریح روی آن می‌آید تا یک کسب‌وکار، دستهٔ کسب‌وکار دیگر را نبیند.
     */
    async categories(options: { scope?: string; businessId?: string | null; parentId?: string | null } = {}): Promise<Row[]> {
      const filters = [sql`c.is_active`];
      if (options.scope) filters.push(sql`c.scope = ${options.scope}`);
      if (options.businessId !== undefined) filters.push(sql`c.business_id is not distinct from ${options.businessId ?? null}`);
      if (options.parentId) filters.push(sql`c.parent_id = ${options.parentId}`);
      const where = filters.reduce((acc, filter) => sql`${acc} and ${filter}`);
      return dal.query(
        sql`select c.id, c.scope, c.business_id, c.parent_id, c.slug, c.path, c.name_fa, c.description, c.icon_key, c.sort_order
            from ref.category c where ${where}
            order by c.sort_order asc, c.name_fa asc
            limit ${PAGE.maxLimit}`,
      );
    },

    /**
     * جست‌وجوی کسب‌وکارهای عمومی (گام ۲۵؛ §57–۶۳).
     *
     * شرط، در پرس‌وجو است (`app.search_businesses`)، نه فیلتر روی یک صفحه از
     * پاسخ. نسخهٔ نخستین این مسیر یک صفحه از فهرست را می‌خواند و بعد در حافظه
     * فیلتر می‌کرد؛ کسب‌وکاری که بیرون از آن صفحه بود، هرگز پیدا نمی‌شد.
     *
     * سقف نتیجه ۵۰ است (در خود تابع هم اعمال می‌شود): جست‌وجو «بهترین چند
     * نتیجه» است، نه فهرست صفحه‌بندی‌شده. برای پیمایش، فهرست و دسته‌ها هستند.
     */
    async searchBusinesses(query: string, limit = 24): Promise<SearchHit[]> {
      return dal.query<SearchHit>(
        sql`select s.id, s.slug, s.name, s.tagline, s.summary, s.business_type_key, s.type_name, s.industry_key,
                   s.verification_level, s.city_slug, s.city_name, s.score
            from app.search_businesses(${query}, ${Math.max(1, Math.min(50, Math.trunc(limit)))}) s`,
      );
    },

    /**
     * آخرین زمان تغییر هر تاکسونومی؛ برای اعتبارسنجی کش.
     * یک پرس‌وجو، چهار عدد — نه چهار پرس‌وجو در چهار جای مختلف.
     */
    async revision(): Promise<{ types: string | null; industries: string | null; locations: string | null; categories: string | null }> {
      const rows = await dal.query<{ types: string | null; industries: string | null; locations: string | null; categories: string | null }>(
        sql`select
              (select max(t.updated_at)::text from ref.business_type t) as types,
              (select max(i.updated_at)::text from ref.industry i) as industries,
              (select max(l.updated_at)::text from ref.location l) as locations,
              (select max(c.updated_at)::text from ref.category c) as categories`,
      );
      return rows[0] ?? { types: null, industries: null, locations: null, categories: null };
    },
  };
}

export type CatalogRepository = ReturnType<typeof catalogRepository>;
