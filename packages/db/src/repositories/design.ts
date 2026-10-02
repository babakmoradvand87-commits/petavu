/**
 * Repository طراحی (§32–۴۴، §161–۱۶۹؛ Addendum §96–۱۰۰).
 *
 * سه قاعده که در SQL هم هست و اینجا فقط رعایت می‌شود:
 *
 *   ۱. **درخت صفحه، داده است نه کد.** پیش از هر ذخیره، `design.validate_tree`
 *      آن را می‌سنجد: هر گره باید کامپوننت شناخته‌شدهٔ Registry باشد، پروپ‌های
 *      لازم را داشته باشد، و هیچ JS/HTML خامی در آن نباشد.
 *   ۲. **هر ذخیره، نسخه می‌سازد.** `design.page_revision` افزودنی است؛ پس تاریخچه
 *      جعل‌شدنی نیست و «چه شد که صفحه این‌طور شد» پاسخ دارد.
 *   ۳. **پیش‌نمایش، لینک زمان‌دار است** نه حالت سراسری.
 */

import { raw, sql } from '../sql.js';
import type { Row } from '../types.js';
import { type RepoDeps, assertPermission, invalid, notFound } from './support.js';

const PAGE_COLUMNS = `p.id, p.business_id, p.key, p.title, p.description, p.scope, p.template_key,
  p.is_system, p.status, p.draft_revision, p.draft_updated_at, p.published_at, p.updated_at, p.version`;

export interface DesignFinding {
  rule?: string;
  severity?: string;
  message?: string;
  path?: string;
}

export function designRepository(deps: RepoDeps) {
  const { dal, context } = deps;

  async function requirePage(pageId: string): Promise<{ business_id: string | null; draft_tree: unknown }> {
    const page = await dal.maybeOne<{ business_id: string | null; draft_tree: unknown }>(
      sql`select p.business_id, p.draft_tree from design.page p where p.id = ${pageId}`,
    );
    if (!page) notFound('design_page', { id: pageId });
    return page;
  }

  async function validate(tree: unknown): Promise<DesignFinding[]> {
    const rows = await dal.query<{ findings: DesignFinding[] }>(
      sql`select design.validate_tree(${JSON.stringify(tree)}::jsonb) as findings`,
    );
    return rows[0]?.findings ?? [];
  }

  return {
    async pageByKey(businessId: string | null, key: string): Promise<Row | null> {
      return dal.maybeOne(
        sql`select ${raw(PAGE_COLUMNS)}, p.published_tree, p.published_release_id, p.draft_tree
            from design.page p
            where p.key = ${key} and (p.business_id = ${businessId} or (p.business_id is null and p.is_system))
            order by (p.business_id is null) asc
            limit 1`,
      );
    },

    async pages(businessId: string): Promise<Row[]> {
      return dal.query(
        sql`select ${raw(PAGE_COLUMNS)} from design.page p
            where p.business_id = ${businessId} or (p.business_id is null and p.is_system)
            order by p.is_system desc, p.key asc`,
      );
    },

    /** اعتبارسنجی درخت، بدون ذخیره — برای استودیو که پیش از انتشار می‌سنجد. */
    validateTree: validate,

    /**
     * ذخیرهٔ پیش‌نویس + ثبت نسخه.
     *
     * اعتبارسنجی اجباری است: درخت نامعتبر اگر ذخیره شود، خطا در زمان رندر و
     * در برابر بازدیدکننده رخ می‌دهد؛ اینجا در برابر سازنده رخ می‌دهد.
     */
    async saveDraft(pageId: string, tree: unknown, changeSummary?: string | null): Promise<Row> {
      const page = await requirePage(pageId);
      if (page.business_id) await assertPermission(deps, page.business_id, 'design.manage');

      const findings = await validate(tree);
      const blockers = findings.filter((finding) => finding.severity === 'blocker');
      if (findings.length > 0 && blockers.length > 0) {
        invalid('invalid_tree', 'درخت صفحه معتبر نیست', { findings: blockers });
      }

      const hashRows = await dal.query<{ hash: string }>(sql`select design.tree_hash(${JSON.stringify(tree)}::jsonb) as hash`);
      const updated = await dal.one<Row>(
        sql`update design.page p
            set draft_tree = ${JSON.stringify(tree)}::jsonb,
                draft_revision = p.draft_revision + 1,
                draft_updated_at = now(),
                draft_updated_by = ${context.userId ?? null}
            where p.id = ${pageId}
            returning ${raw(PAGE_COLUMNS)}, p.draft_revision`,
      );

      await dal.execute(
        sql`insert into design.page_revision (page_id, revision, tree, tree_hash, change_summary, created_by)
            values (${pageId}, ${Number((updated as { draft_revision: number }).draft_revision)},
                    ${JSON.stringify(tree)}::jsonb, ${String(hashRows[0]?.hash ?? '')},
                    ${changeSummary ?? null}, ${context.userId ?? null})
            returning id`,
      );

      return updated;
    },

    /**
     * انتشار صفحه: درخت پیش‌نویس به درخت منتشرشده می‌رود، و رخداد می‌رود.
     *
     * در یک تراکنش انجام می‌شود (فراخوان، `withContext` را دور آن می‌گذارد):
     * صفحه‌ای که «منتشر شد ولی درختش نصفه است» وجود ندارد.
     */
    async publish(pageId: string, note?: string | null): Promise<Row> {
      const page = await requirePage(pageId);
      if (page.business_id) await assertPermission(deps, page.business_id, 'design.publish');
      if (!page.draft_tree) invalid('empty_draft', 'پیش‌نویسی برای انتشار وجود ندارد');

      const findings = await validate(page.draft_tree);
      const blockers = findings.filter((finding) => finding.severity === 'blocker');
      if (blockers.length > 0) invalid('invalid_tree', 'درخت صفحه پیش از انتشار، مانع دارد', { findings: blockers });

      const updated = await dal.one<Row>(
        sql`update design.page p
            set published_tree = p.draft_tree,
                published_at = now(),
                published_by = ${context.userId ?? null},
                status = 'published'
            where p.id = ${pageId}
            returning ${raw(PAGE_COLUMNS)}`,
      );

      await dal.execute(
        sql`select app.emit_event('design.published', 'design_page', ${pageId}, ${page.business_id ?? null},
              ${JSON.stringify({ note: note ?? null })}::jsonb)`,
      );

      return updated;
    },

    /** بازگردانی: پیش‌نویس به یک نسخهٔ پیشین برمی‌گردد؛ خودِ نسخه‌ها دست‌نخورده می‌مانند. */
    async restoreRevision(pageId: string, revision: number): Promise<Row> {
      const page = await requirePage(pageId);
      if (page.business_id) await assertPermission(deps, page.business_id, 'design.rollback');

      const revisionRow = await dal.maybeOne<{ tree: unknown; tree_hash: string }>(
        sql`select r.tree, r.tree_hash from design.page_revision r where r.page_id = ${pageId} and r.revision = ${revision}`,
      );
      if (!revisionRow) notFound('design_revision', { page_id: pageId, revision });

      const updated = await dal.one<Row>(
        sql`update design.page p
            set draft_tree = ${JSON.stringify(revisionRow.tree)}::jsonb,
                draft_revision = p.draft_revision + 1,
                draft_updated_at = now(),
                draft_updated_by = ${context.userId ?? null}
            where p.id = ${pageId}
            returning ${raw(PAGE_COLUMNS)}`,
      );

      await dal.execute(
        sql`select app.record_audit('design.restore', 'design_page', ${pageId}, ${page.business_id ?? null},
              ${JSON.stringify({ restored_revision: revision, tree_hash: revisionRow.tree_hash })}::jsonb)`,
      );

      return updated;
    },

    /** تاریخچهٔ نسخه‌ها؛ برای مقایسه و بازگردانی. */
    async revisions(pageId: string, limit = 30): Promise<Row[]> {
      return dal.query(
        sql`select r.id, r.revision, r.tree_hash, r.change_summary, r.created_by, r.created_at
            from design.page_revision r
            where r.page_id = ${pageId}
            order by r.revision desc
            limit ${limit}`,
      );
    },

    /** لینک پیش‌نمایش زمان‌دار؛ توکن فقط درهم‌شده ذخیره می‌شود (§13). */
    async createPreviewLink(pageId: string, input: { tokenHash: string; expiresAt: string; audience?: string }): Promise<Row> {
      const page = await requirePage(pageId);
      if (page.business_id) await assertPermission(deps, page.business_id, 'design.manage');
      return dal.one(
        sql`insert into design.preview_link (page_id, token_hash, audience, created_by, expires_at)
            values (${pageId}, ${input.tokenHash}, ${input.audience ?? 'business'}, ${context.userId ?? null}, ${input.expiresAt})
            returning id, page_id, audience, created_at, expires_at`,
      );
    },

    /** توکن‌های طراحی؛ منبع رنگ/فاصله/فونت در رندر. مقدار توکن، JSON است. */
    async tokens(options: { businessId?: string | null; themeMode?: string } = {}): Promise<Row[]> {
      const filters = [sql`t.theme_mode = ${options.themeMode ?? 'light'}`];
      if (options.businessId) filters.push(sql`(t.business_id = ${options.businessId} or t.business_id is null)`);
      else filters.push(sql`t.business_id is null`);
      const where = filters.reduce((acc, filter) => sql`${acc} and ${filter}`);
      return dal.query(
        sql`select t.id, t.business_id, t.group_key, t.key, t.value, t.value_type, t.alias_of, t.description, t.is_system
            from design.token t where ${where}
            order by t.group_key asc, t.key asc`,
      );
    },

    /** کامپوننت‌های Registry — تنها چیزهایی که در درخت صفحه مجازند. */
    async components(options: { status?: string } = {}): Promise<Row[]> {
      const status = options.status ?? 'active';
      return dal.query(
        sql`select c.key, c.name_fa, c.category, c.schema_version, c.props_schema, c.slots, c.a11y, c.seo, c.performance, c.status
            from design.component c
            where c.status = ${status}
            order by c.category asc, c.key asc`,
      );
    },
  };
}

export type DesignRepository = ReturnType<typeof designRepository>;
