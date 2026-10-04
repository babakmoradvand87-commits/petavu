/**
 * Repository کسب‌وکار (گام ۱۹؛ §18–۲۴، §139–۱۴۱؛ Addendum §20).
 *
 * موجودیت مرکزی پلتفرم. سه تصمیم در این فایل تکرار می‌شود و ارزش گفتن دارد:
 *
 *   ۱. **ایجاد کسب‌وکار، سه چیز است نه یکی**: ردیف کسب‌وکار، پروفایل خالی، و
 *      عضویت مالک. اگر جدا انجام شوند، در میانهٔ راه کسب‌وکاری می‌ماند که
 *      مالک ندارد و هیچ‌کس — حتی صاحبش — نمی‌تواند بازش کند. پس هر سه در یک
 *      تراکنش.
 *   ۲. **انتقال مالکیت، مسیر ویژه دارد** (`app.complete_ownership_transfer`) و
 *      Repository از خودش نمی‌سازد: تأیید مجدد، انقضا، رخداد و حسابرسی در SQL
 *      است.
 *   ۳. **پذیرش دعوت‌نامه هم تابع دامنه است** (`app.accept_invitation`) چون
 *      یک‌بارمصرفی توکن و کنترل انقضا باید در یک جا، کنار داده، تصمیم بگیرد.
 */

import { raw, sql } from '../sql.js';
import type { Row } from '../types.js';
import type { Cursor, Page, PageRequest } from '../pagination.js';
import { PAGE, type RepoDeps, assertPermission, hasPermission, invalid, notFound, pageTail } from './support.js';

export interface BusinessRow extends Row {
  id: string;
  slug: string;
  name: string;
  name_latin: string | null;
  business_type_key: string;
  industry_key: string | null;
  status: string;
  visibility: string;
  verification_level: string;
  member_count: number;
  listing_count: number;
  media_count: number;
  profile_completeness: number;
  published_at: string | null;
  owner_user_id: string;
  created_at: string;
  version: number;
}

/** ستون‌های کسب‌وکار؛ صریح، در یک جا. `select *` جایی ندارد (Addendum §19). */
const BUSINESS_COLUMNS = `b.id, b.slug, b.name, b.legal_name, b.name_latin, b.business_type_key, b.industry_key,
  b.primary_location_id, b.owner_user_id, b.status, b.visibility, b.verification_level,
  b.member_count, b.listing_count, b.media_count, b.profile_completeness,
  b.published_at, b.suspended_at, b.archived_at, b.created_at, b.updated_at, b.version`;

export interface ListBusinessesOptions extends PageRequest {
  businessTypeKey?: string;
  industryKey?: string;
  status?: string;
  /** فقط کسب‌وکارهای خودِ کاربر (فهرست «کسب‌وکارهای من»). */
  mineOf?: string | null;
  /** فقط عمومی‌ها — مسیر بی‌نام. */
  onlyPublic?: boolean;
}

export function businessRepository(deps: RepoDeps) {
  const { dal, context } = deps;

  return {
    async byId(id: string): Promise<BusinessRow | null> {
      return dal.maybeOne<BusinessRow>(
        sql`select ${raw(BUSINESS_COLUMNS)} from app.business b where b.id = ${id} and b.deleted_at is null`,
      );
    },

    async bySlug(slug: string): Promise<BusinessRow | null> {
      return dal.maybeOne<BusinessRow>(
        sql`select ${raw(BUSINESS_COLUMNS)} from app.business b where b.slug = ${slug} and b.deleted_at is null`,
      );
    },

    /**
     * فهرست با صفحه‌بندی نشانگری.
     *
     * ترتیب پیش‌فرض `name` است نه `created_at`: فهرست عمومی باید برای کاربر
     * پایدار و قابل‌پیش‌بینی باشد و «تازه‌ترین» در فهرست کشف، ردیف‌ها را با هر
     * ثبت‌نام جابه‌جا می‌کند.
     */
    async list(options: ListBusinessesOptions = {}): Promise<Page<BusinessRow>> {
      const filters = [sql`b.deleted_at is null`];
      if (options.businessTypeKey) filters.push(sql`b.business_type_key = ${options.businessTypeKey}`);
      if (options.industryKey) filters.push(sql`b.industry_key = ${options.industryKey}`);
      if (options.status) filters.push(sql`b.status = ${options.status}`);
      if (options.onlyPublic) filters.push(sql`b.status = 'active' and b.visibility = 'public'`);
      if (options.mineOf) {
        filters.push(
          sql`exists (select 1 from app.membership m where m.business_id = b.id and m.user_id = ${options.mineOf} and m.status = 'active' and m.deleted_at is null)`,
        );
      }

      const tail = pageTail({ orderBy: 'b.name', keyExpression: 'b.name', idColumn: 'b.id', direction: 'asc' });
      return dal.page<BusinessRow>({
        request: options,
        defaultLimit: PAGE.defaultLimit,
        maxLimit: PAGE.maxLimit,
        statement: (cursor, fetchLimit) =>
          sql`select ${raw(BUSINESS_COLUMNS)} from app.business b where ${sql`${filters.reduce((acc, filter) => sql`${acc} and ${filter}`)}`} ${tail(cursor, fetchLimit)}`,
        extract: (row) => ({ key: row.name, id: row.id }),
      });
    },

    /**
     * ایجاد کسب‌وکار — کسب‌وکار + پروفایل + عضویت مالک، در یک تراکنش.
     *
     * اجرای بیرون از تراکنش، خطای صریح می‌دهد: اگر این سه نیمه‌کاره بمانند،
     * کسب‌وکار بی‌مالک ساخته می‌شود که هیچ مسیر بازیابی‌ای ندارد.
     */
    async create(input: {
      slug: string;
      name: string;
      businessTypeKey: string;
      industryKey?: string | null;
      nameLatin?: string | null;
      ownerUserId: string;
    }): Promise<BusinessRow> {
      if (context.userId !== input.ownerUserId) {
        invalid('owner_mismatch', 'سازندهٔ کسب‌وکار باید همان مالک باشد');
      }

      const created = await dal.one<BusinessRow>(
        sql`insert into app.business (slug, name, name_latin, business_type_key, industry_key, owner_user_id)
            values (${input.slug}, ${input.name}, ${input.nameLatin ?? null}, ${input.businessTypeKey}, ${input.industryKey ?? null}, ${input.ownerUserId})
            returning ${raw(BUSINESS_COLUMNS.replaceAll('b.', ''))}`,
      );

      /*
       * ترتیب مهم است و یک بار آزمون واقعی آن را نشان داد: عضویت **پیش** از
       * پروفایل ساخته می‌شود. سیاست `business_profile` روی جدول پروفایل،
       * «مجوز ویرایش کسب‌وکار» می‌خواهد؛ و آن مجوز از عضویت می‌آید. اگر پروفایل
       * اول ساخته شود، در برابر RLS رد می‌شود — کسب‌وکار بدون پروفایل می‌ماند.
       */
      const role = await dal.maybeOne<{ id: string }>(
        sql`select r.id from app.role r where r.business_id is null and r.key = 'owner'`,
      );
      if (!role) notFound('role', { key: 'owner' });

      await dal.execute(
        sql`insert into app.membership (business_id, user_id, role_id, status, joined_at)
            values (${created.id}, ${input.ownerUserId}, ${role.id}, 'active', now())
            returning id`,
      );

      await dal.execute(sql`insert into app.business_profile (business_id) values (${created.id}) returning business_id`);

      await dal.query(
        sql`select app.emit_event('business.created', 'business', ${created.id}, ${created.id},
              ${JSON.stringify({ slug: created.slug, type: created.business_type_key })}::jsonb)`,
      );

      return created;
    },

    /** ویرایش کسب‌وکار با کنترل نسخه (§55) و نگهبان مجوز (§14). */
    async update(
      id: string,
      expectedVersion: number,
      values: Partial<Pick<BusinessRow, 'name' | 'name_latin' | 'industry_key' | 'visibility' | 'primary_location_id'>>,
    ): Promise<BusinessRow> {
      await assertPermission(deps, id, 'business.update');
      const updated = await dal.updateWithVersion({
        table: 'app.business',
        id,
        expectedVersion,
        values: { ...values, updated_at: new Date().toISOString() },
        returning: BUSINESS_COLUMNS.replaceAll('b.', '').split(',').map((column) => column.trim()),
      });
      return updated as unknown as BusinessRow;
    },

    /** پروفایل عمومی/داخلی کسب‌وکار. */
    async profile(businessId: string): Promise<Row | null> {
      return dal.maybeOne(
        sql`select p.business_id, p.tagline, p.summary, p.description, p.founded_year, p.employee_range,
                   p.logo_asset_id, p.cover_asset_id, p.links, p.attributes, p.keywords, p.updated_at, p.version
            from app.business_profile p where p.business_id = ${businessId}`,
      );
    },

    async upsertProfile(businessId: string, values: Record<string, unknown>, expectedVersion = 0): Promise<Row> {
      await assertPermission(deps, businessId, 'business.update');
      return dal.one(sql`select p.business_id, p.tagline, p.summary, p.description, p.founded_year, p.employee_range,
        p.logo_asset_id, p.cover_asset_id, p.links, p.attributes, p.keywords, p.updated_at, p.version
        from app.save_business_profile(${businessId}, ${expectedVersion}, ${JSON.stringify(values)}::jsonb) p`);
    },

    /**
     * اعضای تیم؛ با نقش و وضعیت، بدون افشای دادهٔ هویتی (§13).
     *
     * اینجا نگهبان مجوز نیست و عمدی است: دیدن فهرست تیم، حق هر **عضو** است،
     * نه حق کسی که مجوز مدیریت دارد. حصار، سیاست RLS روی `app.membership` است
     * که فقط به اعضای همان کسب‌وکار اجازهٔ دیدن می‌دهد — و آزمون، همان را
     * می‌سنجد.
     */
    async members(businessId: string): Promise<Row[]> {
      void deps;
      return dal.query(
        sql`select m.id, m.user_id, u.display_name, m.job_title, r.key as role_key, r.name_fa as role_name,
                   m.status, m.joined_at, m.version
            from app.membership m
            join app.role r on r.id = m.role_id
            join auth.app_user u on u.id = m.user_id
            where m.business_id = ${businessId} and m.deleted_at is null and m.status <> 'left'
            order by r.rank asc, u.display_name asc`,
      );
    },

    async invite(input: {
      businessId: string;
      roleKey: string;
      inviteeKind: 'email' | 'phone';
      inviteeHash: string;
      inviteeDisplay: string;
      tokenHash: string;
      expiresAt: string;
      message?: string | null;
    }): Promise<Row> {
      await assertPermission(deps, input.businessId, 'business.member.invite');
      const role = await dal.maybeOne<{ id: string }>(
        sql`select r.id from app.role r where r.business_id is null and r.key = ${input.roleKey}`,
      );
      if (!role) notFound('role', { key: input.roleKey });

      return dal.one(
        sql`insert into app.invitation (business_id, role_id, invitee_kind, invitee_hash, invitee_display, token_hash, invited_by, message, expires_at)
            values (${input.businessId}, ${role.id}, ${input.inviteeKind}, ${input.inviteeHash}, ${input.inviteeDisplay},
                    ${input.tokenHash}, ${context.userId ?? null}, ${input.message ?? null}, ${input.expiresAt})
            returning id, business_id, role_id, invitee_display, expires_at, created_at`,
      );
    },

    /** پذیرش دعوت‌نامه — تابع دامنه تصمیم می‌گیرد، نه Repository. */
    async acceptInvitation(invitationId: string, tokenHash: string): Promise<Row> {
      return dal.one(sql`select app.accept_invitation(${invitationId}, ${tokenHash}) as result`).then((row) => row.result as Row);
    },

    async revokeInvitation(invitationId: string, reason?: string | null): Promise<Row> {
      const invitation = await dal.maybeOne<{ business_id: string }>(
        sql`select i.business_id from app.invitation i where i.id = ${invitationId}`,
      );
      if (!invitation) notFound('invitation', { id: invitationId });
      await assertPermission(deps, invitation.business_id, 'business.member.manage');
      const revoked = await dal.query<{ result: string }>(
        sql`select app.revoke_invitation(${invitationId}, ${reason ?? null}) as result`,
      );
      return { id: invitationId, revoked: revoked.length > 0 } as unknown as Row;
    },

    /** نقش‌های قائل (سیستمی) برای انتخاب در دعوت. */
    async roles(): Promise<Row[]> {
      return dal.query(
        sql`select r.id, r.key, r.name_fa, r.description, r.rank
            from app.role r where r.business_id is null order by r.rank asc`,
      );
    },

    /**
     * رابط گراف کسب‌وکار: روابط تأییدشدهٔ دوطرفه.
     * رابطهٔ یک‌طرفه، «رابطه» نیست؛ فقط پس از تأیید طرف مقابل معنا دارد (§21).
     */
    async relationships(businessId: string): Promise<Row[]> {
      return dal.query(
        sql`select rel.id, rel.kind, rel.status, rel.is_symmetric,
                   case when rel.from_business_id = ${businessId} then rel.to_business_id else rel.from_business_id end as other_id,
                   other.name as other_name, other.slug as other_slug, rel.created_at, rel.confirmed_at
            from app.business_relationship rel
            join app.business other
              on other.id = case when rel.from_business_id = ${businessId} then rel.to_business_id else rel.from_business_id end
            where (rel.from_business_id = ${businessId} or rel.to_business_id = ${businessId})
              and rel.status in ('active', 'pending')
            order by rel.created_at desc`,
      );
    },

    /**
     * سطح تکمیل پروفایل.
     *
     * از خودِ داده محاسبه می‌شود، نه از شمارندهٔ دستی — شمارنده‌ای که کسی
     * به‌روزش نمی‌کند، در نهایت دروغ می‌گوید. اگر کاربر مجوز ویرایش داشته
     * باشد، نتیجه در ستون مادیت هم می‌شود؛ وگرنه فقط برگردانده می‌شود.
     */
    async completeness(businessId: string): Promise<number> {
      const rows = await dal.query<{ value: number }>(
        sql`with score as (
              select (
                (case when btrim(coalesce(p.tagline, '')) <> '' then 10 else 0 end) +
                (case when length(btrim(coalesce(p.summary, ''))) >= 60 then 10 else 0 end) +
                (case when length(btrim(coalesce(p.description, ''))) >= 300 then 15 else 0 end) +
                (case when p.logo_asset_id is not null then 10 else 0 end) +
                (case when p.cover_asset_id is not null then 10 else 0 end) +
                (case when coalesce(jsonb_array_length(case when jsonb_typeof(p.links) = 'array' then p.links else '[]'::jsonb end), 0) > 0 then 5 else 0 end) +
                (case when coalesce(cardinality(p.keywords), 0) > 0 then 5 else 0 end) +
                (case when b.primary_location_id is not null then 10 else 0 end) +
                (case when exists (select 1 from app.business_contact c where c.business_id = b.id) then 15 else 0 end) +
                (case when b.verification_level <> 'none' then 10 else 0 end)
              )::smallint as value
              from app.business b
              left join app.business_profile p on p.business_id = b.id
              where b.id = ${businessId} and b.deleted_at is null
            )
            select s.value from score s`,
      );
      const value = Number(rows[0]?.value ?? 0);

      if (await hasPermission(deps, businessId, 'business.update')) {
        await dal.execute(
          sql`update app.business set profile_completeness = ${value}
              where id = ${businessId} and profile_completeness <> ${value}`,
        );
      }
      return value;
    },

    /** پیشنهاد نامک از نام؛ یکدست با قاعدهٔ پایگاه‌داده (`app.slug_base`). */
    async suggestSlug(input: string): Promise<string> {
      const rows = await dal.query<{ slug: string }>(sql`select app.slug_base(${input}) as slug`);
      return String(rows[0]?.slug ?? '');
    },
  };
}

export type BusinessRepository = ReturnType<typeof businessRepository>;
export type { Cursor };
