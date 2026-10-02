/**
 * Repository محتوا و رسانه (§23، §74–۷۵؛ Addendum §21–۲۴).
 *
 * قاعدهٔ اصلی: **چرخهٔ عمر محتوا اینجا پیاده نمی‌شود.** گذر از `draft` به
 * `published` یک تابع دامنه است (`app.transition_content`) که تأیید مجوز
 * مبدأ/مقصد، رخداد، حسابرسی و زمان‌بندی را در یک جا نگه می‌دارد. اگر
 * Repository خودش `update ... set status` بزند، همان تغییر از مسیر کناری
 * انجام می‌شود: بی‌رخداد، بی‌حسابرسی، و با یک قاعده‌سازی که کسی نمی‌بیند.
 */

import { raw, sql } from '../sql.js';
import type { Row } from '../types.js';
import type { Page } from '../pagination.js';
import { PAGE, type RepoDeps, assertPermission, invalid, notFound, pageTail, recordFields } from './support.js';

const CONTENT_FIELDS = [
  'id', 'business_id', 'kind', 'slug', 'title', 'subtitle', 'summary', 'cover_asset_id',
  'author_user_id', 'author_display', 'status', 'visibility', 'locale', 'weight', 'is_featured',
  'published_at', 'scheduled_for', 'updated_at', 'created_at', 'version',
] as const;

const CONTENT_COLUMNS = CONTENT_FIELDS.map((field) => `c.${field}`).join(', ');

export interface ListContentOptions {
  cursor?: string | null;
  limit?: number | null;
  kind?: string;
  status?: string;
  /** فقط محتوای منتشرشده — مسیر عمومی. */
  onlyPublished?: boolean;
  search?: string;
}

export function contentRepository(deps: RepoDeps) {
  const { dal, context } = deps;

  return {
    async byId(id: string): Promise<Row | null> {
      return dal.maybeOne(
        sql`select ${raw(CONTENT_COLUMNS)}, c.body, c.body_text from app.content c
            where c.id = ${id} and c.deleted_at is null`,
      );
    },

    /** محتوا با نامک، در دامنهٔ کسب‌وکار. نامک‌ها فقط داخل یک کسب‌وکار یکتا هستند. */
    async bySlug(businessId: string, slug: string, kind?: string): Promise<Row | null> {
      const kindFilter = kind ? sql`and c.kind = ${kind}` : sql``;
      return dal.maybeOne(
        sql`select ${raw(CONTENT_COLUMNS)}, c.body, c.body_text from app.content c
            where c.business_id = ${businessId} and c.slug = ${slug} and c.deleted_at is null ${kindFilter}`,
      );
    },

    async list(businessId: string, options: ListContentOptions = {}): Promise<Page<Row>> {
      const filters = [sql`c.business_id = ${businessId}`, sql`c.deleted_at is null`];
      if (options.kind) filters.push(sql`c.kind = ${options.kind}`);
      if (options.status) filters.push(sql`c.status = ${options.status}`);
      if (options.onlyPublished) {
        filters.push(sql`c.status = 'published' and c.visibility <> 'private' and (c.published_at is null or c.published_at <= now())`);
      }
      if (options.search) {
        /*
         * جست‌وجوی متنی روی `body_text` (ستون وزن‌سبک، بدون تگ) و عنوان.
         * این «جست‌وجوی اصلی» نیست — آن در گام ۳۳ با آداپتور می‌آید؛ ولی
         * فهرست پنل بدون یک فیلتر ساده، غیرقابل‌استفاده است.
         */
        filters.push(sql`(c.title ilike ${`%${options.search}%`} or c.body_text ilike ${`%${options.search}%`})`);
      }

      const tail = pageTail({ orderBy: 'c.created_at', keyExpression: 'c.created_at', idColumn: 'c.id' });
      const where = filters.reduce((acc, filter) => sql`${acc} and ${filter}`);

      return dal.page<Row>({
        request: options,
        defaultLimit: PAGE.defaultLimit,
        maxLimit: PAGE.maxLimit,
        statement: (cursor, fetchLimit) =>
          sql`select ${raw(CONTENT_COLUMNS)} from app.content c where ${where} ${tail(cursor, fetchLimit)}`,
        extract: (row) => ({ key: String(row.created_at), id: String(row.id) }),
      });
    },

    async create(
      businessId: string,
      input: { kind: string; slug: string; title: string; subtitle?: string | null; summary?: string | null; body?: unknown; bodyText?: string | null; locale?: string },
    ): Promise<Row> {
      await assertPermission(deps, businessId, 'content.create');
      if (input.title.trim().length < 2) invalid('short_title', 'عنوان کوتاه است');
      const author = await dal.maybeOne<{ display_name: string }>(
        sql`select u.display_name from auth.app_user u where u.id = ${context.userId ?? null}`,
      );
      return dal.one(
        /*
         * `body` یک سند JSON است، نه متن: ساختار بلوک‌ها همان چیزی است که رندر
         * می‌خواند و باید شکل معتبر داشته باشد. متن وزن‌سبک (`body_text`) جدا
         * ذخیره می‌شود تا جست‌وجو و ایندکس متنی روی همان کار کند.
         */
        sql`insert into app.content (business_id, kind, slug, title, subtitle, summary, body, body_text, author_user_id, author_display, locale)
            values (${businessId}, ${input.kind}, ${input.slug}, ${input.title.trim()}, ${input.subtitle ?? null},
                    ${input.summary ?? null},
                    ${JSON.stringify(input.body ?? { type: 'doc', blocks: [] })}::jsonb,
                    ${input.bodyText ?? null}, ${context.userId ?? null},
                    ${author?.display_name ?? null}, ${input.locale ?? 'fa-IR'})
            returning ${raw(CONTENT_COLUMNS.replaceAll('c.', ''))}`,
      );
    },

    async update(
      contentId: string,
      expectedVersion: number,
      values: Record<string, unknown>,
    ): Promise<Row> {
      const existing = await dal.maybeOne<{ business_id: string | null }>(
        sql`select c.business_id from app.content c where c.id = ${contentId} and c.deleted_at is null`,
      );
      if (!existing) notFound('content', { id: contentId });
      if (existing.business_id) await assertPermission(deps, existing.business_id, 'content.update');

      const allowed = ['title', 'subtitle', 'summary', 'body', 'body_text', 'kind', 'slug', 'visibility', 'weight', 'is_featured', 'cover_asset_id', 'locale'];
      const entries = Object.entries(values).filter(([key]) => allowed.includes(key));
      if (entries.length === 0) invalid('no_values', 'هیچ فیلد قابل‌ویرایشی فرستاده نشده');

      // `body` سند JSON است؛ آبجکت خام باید به متن JSON تبدیل شود.
      const normalized = Object.fromEntries(
        entries.map(([key, value]) => [key, key === 'body' && typeof value === 'object' && value !== null ? JSON.stringify(value) : value]),
      );

      return dal.updateWithVersion({
        table: 'app.content',
        id: contentId,
        expectedVersion,
        values: normalized,
        tenant: existing.business_id ? { column: 'business_id', value: existing.business_id } : undefined,
        returning: CONTENT_COLUMNS.replaceAll('c.', '').split(',').map((column) => column.trim()),
      });
    },

    /**
     * گذر وضعیت — فقط از راه تابع دامنه.
     * به‌عمد هیچ پارامتر `status` در `update` بالا نیست تا این تنها مسیر بماند.
     */
    async transition(contentId: string, to: string, reason?: string | null): Promise<Row> {
      return dal.one(
        sql`select ${recordFields('r', CONTENT_FIELDS)} from app.transition_content(${contentId}, ${to}, ${reason ?? null}) r`,
      );
    },

    async schedule(contentId: string, publishAt: string): Promise<Row> {
      return dal.one(
        sql`select ${recordFields('r', CONTENT_FIELDS)} from app.schedule_content(${contentId}, ${publishAt}) r`,
      );
    },

    /** بلوک‌های محتوا، به ترتیب. */
    async blocks(contentId: string): Promise<Row[]> {
      return dal.query(
        sql`select b.id, b.content_id, b.kind, b.sort_order, b.data, b.plain_text, b.version
            from app.content_block b
            where b.content_id = ${contentId}
            order by b.sort_order asc, b.id asc`,
      );
    },

    /**
     * جایگزینی کامل بلوک‌ها.
     *
     * «حذف همه + درج همه» در یک تراکنش، از «به‌روزرسانی تفاضلی» امن‌تر است:
     * تفاضل، جابه‌جایی ترتیب را به‌روزرسانی‌های تکی تبدیل می‌کند که نیمه‌کاره
     * می‌توانند بمانند. تابع چرخهٔ عمر `app.touch()` هم زمان ویرایش را می‌زند.
     */
    async replaceBlocks(contentId: string, blocks: ReadonlyArray<{ kind: string; data: Record<string, unknown>; plainText?: string }>): Promise<number> {
      const content = await dal.maybeOne<{ business_id: string | null }>(
        sql`select c.business_id from app.content c where c.id = ${contentId} and c.deleted_at is null`,
      );
      if (!content) notFound('content', { id: contentId });
      if (content.business_id) await assertPermission(deps, content.business_id, 'content.update');

      await dal.execute(sql`delete from app.content_block where content_id = ${contentId}`);

      let order = 0;
      for (const block of blocks) {
        await dal.execute(
          sql`insert into app.content_block (content_id, kind, sort_order, data, plain_text)
              values (${contentId}, ${block.kind}, ${order}, ${JSON.stringify(block.data)}::jsonb, ${block.plainText ?? null})
              returning id`,
        );
        order += 1;
      }
      return order;
    },

    /** رسانه‌های کسب‌وکار؛ `select` صریح، راز و کلید ذخیره‌سازی بیرون نمی‌رود. */
    async assets(businessId: string, options: { cursor?: string | null; limit?: number | null; kind?: string; onlyPublic?: boolean } = {}): Promise<Page<Row>> {
      const filters = [sql`a.business_id = ${businessId}`, sql`a.deleted_at is null`];
      if (options.kind) filters.push(sql`a.kind = ${options.kind}`);
      if (options.onlyPublic) filters.push(sql`a.is_public and a.status = 'ready'`);
      const where = filters.reduce((acc, filter) => sql`${acc} and ${filter}`);
      const tail = pageTail({ orderBy: 'a.created_at', keyExpression: 'a.created_at', idColumn: 'a.id' });

      return dal.page<Row>({
        request: options,
        statement: (cursor, fetchLimit) =>
          sql`select a.id, a.business_id, a.kind, a.original_name, a.detected_mime, a.size_bytes, a.width, a.height,
                     a.width_height_ratio, a.alt_text, a.caption, a.is_public, a.status, a.scan_status, a.created_at
              from media.asset a where ${where} ${tail(cursor, fetchLimit)}`,
        extract: (row) => ({ key: String(row.created_at), id: String(row.id) }),
      });
    },

    /** یک دارایی رسانه، با کنترل مالکیت (§15 IDOR). */
    async asset(businessId: string, assetId: string): Promise<Row | null> {
      return dal.maybeOne(
        sql`select a.id, a.business_id, a.kind, a.original_name, a.detected_mime, a.size_bytes, a.width, a.height,
                   a.alt_text, a.caption, a.is_public, a.status, a.scan_status
            from media.asset a
            where a.id = ${assetId} and a.business_id = ${businessId} and a.deleted_at is null`,
      );
    },
  };
}

export type ContentRepository = ReturnType<typeof contentRepository>;
