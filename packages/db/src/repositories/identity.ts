/**
 * Repository هویت (§6–۱۷؛ Addendum §20).
 *
 * **چه چیزی اینجا نیست و چرا:** هیچ نوشتنی روی اعتبارنامه، نشست، کد
 * بازیابی و توکن دومرحله‌ای. آن جدول‌ها در گام‌های ۵–۶ ساخته شدند و گرنت
 * `pv_app` روی آن‌ها عمداً محدود است؛ مسیر نوشتنشان لایهٔ احراز هویت
 * (گام ۲۱، `@petavu/security`) است، نه Repository عمومی. دلیل: یک Repository
 * که «هر جا لازم شد» راز می‌نویسد، در نهایت از یک مسیر بدون rate limit هم
 * نوشته می‌شود.
 *
 * این Repository فقط پرسش‌های هویتیِ لازم برای تصمیم‌گیری و نمایش را دارد:
 * کاربر با شناسه، کاربر با ایمیل/موبایل (برای ورود و دعوت)، و پروفایل عمومی.
 */

import { raw, sql } from '../sql.js';
import type { Row } from '../types.js';
import { type RepoDeps, invalid, notFound, recordFields } from './support.js';

/** ستون‌های کاربر؛ صریح. هرگز `select *` از جدولی که روزی ستون راز می‌گیرد. */
const USER_FIELDS = ['id', 'display_name', 'short_name', 'status', 'avatar_asset_id', 'locale', 'timezone', 'mfa_required', 'last_login_at', 'created_at', 'version'] as const;
const USER_COLUMNS = USER_FIELDS.map((field) => `u.${field}`).join(', ');

export function identityRepository(deps: RepoDeps) {
  const { dal } = deps;

  return {
    async byId(userId: string): Promise<Row | null> {
      return dal.maybeOne(
        sql`select ${raw(USER_COLUMNS)} from auth.app_user u
            where u.id = ${userId} and u.deleted_at is null`,
      );
    },

    /**
     * کاربر با شناسهٔ هویتی (ایمیل/موبایل).
     *
     * درآمدن با `value_key` انجام می‌شود، نه با مقدار خام: نرمال‌سازی و
     * درهم‌سازی هویت در گام ۶ انجام شده و اینجا فقط مصرف می‌شود. اگر روزی
     * الگوریتم عوض شود، همین یک ستون عوض می‌شود.
     */
    async byIdentity(kind: 'email' | 'phone', valueKey: string): Promise<Row | null> {
      if (valueKey.trim() === '') invalid('empty_identity', 'شناسهٔ ورود خالی است');
      return dal.maybeOne(
        sql`select ${raw(USER_COLUMNS)}, i.kind as identity_kind, i.verified_at as identity_verified_at
            from auth.identity i
            join auth.app_user u on u.id = i.user_id
            where i.kind = ${kind} and i.value_key = ${valueKey}
              and i.deleted_at is null and u.deleted_at is null`,
      );
    },

    /** همهٔ شناسه‌های یک کاربر؛ برای صفحهٔ امنیت حساب. */
    async identities(userId: string): Promise<Row[]> {
      return dal.query(
        sql`select i.id, i.kind, i.value_display, i.is_primary, i.verified_at, i.verified_via, i.created_at
            from auth.identity i
            where i.user_id = ${userId} and i.deleted_at is null
            order by i.is_primary desc, i.kind asc`,
      );
    },

    /**
     * ساخت کاربر تازه.
     *
     * `status` عمداً `pending` می‌ماند: کاربری که هویتش تأیید نشده، نباید بتواند
     * کسب‌وکار بسازد. فعال‌سازی، کارِ مسیر تأیید هویت است.
     */
    /**
     * ساخت کاربر در مسیر ثبت‌نام.
     *
     * عمداً از تابع دامنه می‌آید، نه `insert … returning` مستقیم: نام کاربر
     * تازه هنوز هیچ‌کس نیست، و سیاست خواندن `auth.app_user` ردیف غریبه را
     * نمی‌دهد. تابع دامنه، درج و بازگرداندن ردیف را با هم انجام می‌دهد و
     * خودش تعیین می‌کند که این کار فقط از نشست بی‌نام یا پنل پلتفرم ممکن است.
     */
    async create(input: { displayName: string; locale?: string; timezone?: string }): Promise<Row> {
      if (input.displayName.trim().length < 2) invalid('short_display_name', 'نام نمایشی کوتاه است');
      return dal.one(
        sql`select ${recordFields('u', USER_FIELDS)}
            from app.register_user(${input.displayName.trim()}, ${input.locale ?? 'fa-IR'}, ${input.timezone ?? 'Asia/Tehran'}) u`,
      );
    },

    /** ویرایش پروفایل خودِ کاربر (نه کاربر دیگر — آن کار پنل مدیریت است). */
    async updateProfile(
      userId: string,
      expectedVersion: number,
      values: { display_name?: string; short_name?: string; locale?: string; timezone?: string; avatar_asset_id?: string },
    ): Promise<Row> {
      if (deps.context.userId !== userId) invalid('not_self', 'ویرایش پروفایل دیگران از این مسیر ممکن نیست');
      if (values.display_name !== undefined && values.display_name.trim().length < 2) {
        invalid('short_display_name', 'نام نمایشی کوتاه است');
      }
      return dal.updateWithVersion({
        table: 'auth.app_user',
        id: userId,
        expectedVersion,
        values,
        returning: USER_COLUMNS.replaceAll('u.', '').split(',').map((column) => column.trim()),
      });
    },

    /** کسب‌وکارهای کاربر با نقش؛ همان چیزی که انتخاب‌گر کسب‌وکار در پنل می‌خواهد. */
    async businessesOf(userId: string): Promise<Row[]> {
      const rows = await dal.query(
        sql`select b.id, b.slug, b.name, b.status, b.visibility, r.key as role_key, r.name_fa as role_name, r.rank
            from app.membership m
            join app.business b on b.id = m.business_id
            join app.role r on r.id = m.role_id
            where m.user_id = ${userId} and m.status = 'active' and m.deleted_at is null
              and b.deleted_at is null
            order by r.rank asc, b.name asc`,
      );
      if (rows.length === 0) return rows;
      return rows;
    },

    /** کاربر باید وجود داشته باشد یا خطای روشن بگیریم؛ کمکِ کوچک برای جریان‌ها. */
    async requireById(userId: string): Promise<Row> {
      const user = await this.byId(userId);
      if (!user) notFound('user', { id: userId });
      return user;
    },
  };
}

export type IdentityRepository = ReturnType<typeof identityRepository>;
