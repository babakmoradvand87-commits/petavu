/**
 * بخش‌های پنل عضو (گام ۲۸؛ §26–۲۷، §15، §191).
 *
 * هر بخش یک تابع رندر و چند کنش است، و **هیچ‌کدام منطق ندارند**: خواندن و تغییر از API می‌گذرد و API
 * (احراز، مجوز، RLS، CSRF) تصمیم می‌گیرد. اگر API «نه» گفت، بخش همان «نه» را به زبان کاربر نشان می‌دهد؛
 * هیچ بخشی «برای اینکه شاید مجاز باشد» دکمه‌ای را پنهان یا آشکار نمی‌کند — مجوز، تصمیم سرور است.
 *
 * یک قرارداد آزمون‌شده: هر ردیف **«آماده»ٔ** منوی `panel` در این فایل یک بخش دارد (آزمون، منو را با
 * رجیستری مقایسه می‌کند). منو داده است؛ فهرست بخش‌ها نباید بی‌صدا از آن عقب بماند.
 */

import {secureAccount} from './mfa.js';
import { pagesSection } from './studio.js';
import { escapeText, raw, tag } from '../html.js';
import { describeProblem } from './core.js';
import {
  actionForm,
  badgeFor,
  card,
  dataTable,
  definitionList,
  emptyNote,
  formBlock,
  htmlOf,
  metricCard,
  pageHeader,
  type Cell,
} from './kit.js';
import type { ActionOutcome, PanelCtx, Section, SectionRegistry, SectionRender } from './types.js';

/* ------------------------------------------------------------------ برچسب‌های فارسی */

export const CONTENT_STATUS_FA: Readonly<Record<string, string>> = {
  draft: 'پیش‌نویس',
  in_review: 'در بازبینی',
  changes_requested: 'نیازمند اصلاح',
  approved: 'تأییدشده',
  scheduled: 'زمان‌بندی‌شده',
  published: 'منتشرشده',
  unpublished: 'برداشته‌شده',
  archived: 'بایگانی‌شده',
};

export const CONTENT_KIND_FA: Readonly<Record<string, string>> = {
  article: 'مقاله',
  guide: 'راهنما',
  service: 'خدمت',
  faq: 'پرسش‌های متداول',
  page: 'صفحه',
  news: 'خبر',
};

export const ROLE_FA: Readonly<Record<string, string>> = {
  owner: 'مالک',
  admin: 'مدیر',
  editor: 'ویرایشگر محتوا',
  marketer: 'بازاریاب',
  member: 'عضو',
  viewer: 'ناظر',
};

const STATUS_TONE: Readonly<Record<string, 'success' | 'warning' | 'danger' | 'neutral'>> = {
  published: 'success',
  approved: 'success',
  in_review: 'warning',
  changes_requested: 'danger',
  draft: 'neutral',
};

export function statusBadge(status: string): Cell {
  return raw(badgeFor(CONTENT_STATUS_FA[status] ?? status, STATUS_TONE[status]));
}

const DATE = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' });
export function shortDate(value: unknown): string {
  if (typeof value !== 'string' && !(value instanceof Date)) return '';
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? '' : DATE.format(date);
}

const NUMBER = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });
export const faNumber = (value: unknown): string => NUMBER.format(Number(value) || 0);

type Json = Record<string, unknown>;
const rowsOf = (json: Json | null, key: string): Json[] => (Array.isArray(json?.[key]) ? (json?.[key] as Json[]) : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));

/** نتیجهٔ ناموفقِ API در یک بخش: کارت توضیح، بی‌جزئیات فنی. */
function failure(title: string, response: { status: number; json: Json | null }): SectionRender {
  const status = response.status === 403 || response.status === 404 ? response.status : response.status >= 500 ? 502 : 200;
  return { html: htmlOf(pageHeader(title), card('انجام نشد', emptyNote(describeProblem(response as never)))), status };
}

const back = (path: string, kind: 'success' | 'error' | 'info', message: string): ActionOutcome => ({ redirect: path, flash: { kind, text: message } });

/** کنشی که فقط یک فراخوانی API است و پیام موفقیت/خطا می‌دهد. */
async function simple(_ctx: PanelCtx, call: () => ReturnType<PanelCtx['api']>, path: string, ok: string): Promise<ActionOutcome> {
  const response = await call();
  return response.status >= 200 && response.status < 300 ? back(path, 'success', ok) : back(path, 'error', describeProblem(response));
}

/* ------------------------------------------------------------------ ۱. داشبورد */

const dashboard: Section = {
  key: 'dashboard',
  title: 'داشبورد',
  async render(ctx) {
    const response = await ctx.api('GET', '/api/v1/panel/dashboard');
    if (response.status !== 200) return failure('داشبورد', response);

    const business = response.json?.['business'] as Json | null;
    if (!business) {
      // حساب تازه: هنوز کسب‌وکاری نیست. راهنما، نه صفحهٔ خالی.
      const types = await ctx.api('GET', '/api/v1/catalog/business-types');
      const options = rowsOf(types.json, 'types').map((type) => ({ value: text(type['key']), label: text(type['name_fa']) }));
      return {
        html: htmlOf(
          pageHeader(`خوش آمدید، ${ctx.session.displayName}`, { subtitle: 'برای شروع، کسب‌وکار خود را بسازید.' }),
          card(
            'ساخت کسب‌وکار',
            formBlock({
              id: 'create-business',
              action: '/app/business/create',
              csrf: ctx.csrf,
              fields: [
                { name: 'name', label: 'نام کسب‌وکار', required: true, maxLength: 120 },
                { name: 'business_type_key', label: 'نوع کسب‌وکار', type: 'select', required: true, options },
              ],
              submit: 'ساخت کسب‌وکار',
            }),
          ),
        ),
      };
    }

    const widgets = rowsOf(response.json, 'widgets');
    const cards = widgets.map((widget) => {
      const items = Array.isArray(widget['items']) ? (widget['items'] as Array<{ key: string; count: number }>) : [];
      const label = text(widget['name_fa']);
      if (widget['source'] === 'completeness') return metricCard(label, `${faNumber(widget['value'])}٪`, 'پروفایل کامل‌تر، دیده‌شدن بیشتر');
      if (widget['kind'] === 'breakdown' && items.length > 0) {
        const labels: Record<string, string> = {
          ...CONTENT_STATUS_FA,
          active_rules: 'قاعدهٔ فعال',
          runs_24h: 'اجرا در ۲۴ ساعت',
          failures_24h: 'شکست در ۲۴ ساعت',
          stuck_runs: 'اجرای گیرکرده',
        };
        return tag('div', { class: 'panel-metric' }, [
          tag('span', { class: 'panel-metric__label' }, escapeText(label)),
          tag('ul', { class: 'panel-breakdown', role: 'list' }, items.map((item) => tag('li', {}, `${escapeText(labels[item.key] ?? item.key)} <strong>${escapeText(faNumber(item.count))}</strong>`)).join('')),
        ].join(''));
      }
      return metricCard(label, faNumber(widget['value']));
    });

    return {
      html: htmlOf(
        pageHeader(text(business['name']), { subtitle: `${text(business['type_name'] ?? business['business_type_key'])} · داشبورد متناسب با این نوع کسب‌وکار` }),
        cards.length > 0 ? tag('div', { class: 'panel-metrics' }, cards.join('')) : card('ویجتی برای نمایش نیست', emptyNote('برای نوع و نقش شما ویجتی تعریف نشده است.')),
      ),
    };
  },
};

/* ------------------------------------------------------------------ ۲. پروفایل */

const profile: Section = {
  key: 'profile',
  title: 'پروفایل عمومی',
  async render(ctx) {
    if (!ctx.session.activeBusinessId) return { html: htmlOf(pageHeader('پروفایل عمومی'), card('کسب‌وکاری فعال نیست', emptyNote('ابتدا از داشبورد کسب‌وکار بسازید.'))) };
    const response = await ctx.api('GET', ctx.businessPath('/profile/edit'));
    // «پروفایل هنوز نیست» (۴۰۴ با دلیل) خطا نیست؛ فرم خالی است.
    const missing = response.status === 404 && ((response.json?.['error'] as { details?: { reason?: string } } | undefined)?.details?.reason === 'profile_missing');
    if (response.status !== 200 && !missing) return failure('پروفایل عمومی', response);
    const current = (response.json?.['profile'] ?? {}) as Json;
    const completeness = await ctx.api('GET', ctx.businessPath('/completeness'));

    return {
      html: htmlOf(
        pageHeader('پروفایل عمومی', { subtitle: 'آنچه اینجا می‌نویسید در سایت عمومی دیده می‌شود. انتشار عمومی، تصمیم خودِ شماست.' }),
        completeness.status === 200 ? tag('div', { class: 'panel-metrics' }, metricCard('کامل‌بودن', `${faNumber(completeness.json?.['completeness'])}٪`)) : '',
        card(
          'مشخصات',
          formBlock({
            id: 'profile',
            action: '/app/profile/save',
            csrf: ctx.csrf,
            fields: [
              { name: 'expected_version', label: '', type: 'hidden', value: text(current['version'] ?? 0) },
              { name: 'tagline', label: 'شعار کوتاه', value: text(current['tagline']), maxLength: 160 },
              { name: 'summary', label: 'خلاصه', type: 'textarea', rows: 3, value: text(current['summary']), maxLength: 600, hint: 'در فهرست‌ها و نتایج جست‌وجو دیده می‌شود.' },
              { name: 'description', label: 'توضیح کامل', type: 'textarea', rows: 8, value: text(current['description']), maxLength: 4000 },
              { name: 'founded_year', label: 'سال تأسیس', value: text(current['founded_year']), maxLength: 4, dir: 'ltr' },
              { name: 'employee_range', label: 'تعداد کارکنان', value: text(current['employee_range']), maxLength: 40 },
            ],
            submit: 'ذخیرهٔ پروفایل',
          }),
        ),
      ),
    };
  },
  actions: {
    async save(ctx) {
      const form = ctx.form ?? {};
      const body: Json = { expected_version: Number(form['expected_version'] ?? 0) };
      for (const field of ['tagline', 'summary', 'description', 'employee_range'] as const) if ((form[field] ?? '').trim() !== '') body[field] = form[field];
      const year = (form['founded_year'] ?? '').trim();
      if (year !== '') {
        if (!/^\d{4}$/.test(year)) return back('/app/profile', 'error', 'سال تأسیس باید چهار رقم باشد.');
        body['founded_year'] = Number(year);
      }
      return simple(ctx, () => ctx.api('PUT', ctx.businessPath('/profile'), body), '/app/profile', 'پروفایل ذخیره شد.');
    },
  },
};

/* ------------------------------------------------------------------ ۳. تیم */

const team: Section = {
  key: 'team',
  title: 'تیم و دعوت‌ها',
  async render(ctx) {
    const [members, invitations] = await Promise.all([ctx.api('GET', ctx.businessPath('/team')), ctx.api('GET', ctx.businessPath('/invitations'))]);
    if (members.status !== 200) return failure('تیم و دعوت‌ها', members);
    const roleOptions = rowsOf(members.json, 'roles')
      .filter((role) => text(role['key']) !== 'owner')
      .map((role) => ({ value: text(role['key']), label: ROLE_FA[text(role['key'])] ?? text(role['name_fa'] ?? role['key']) }));

    return {
      html: htmlOf(
        pageHeader('تیم و دعوت‌ها'),
        card(
          'اعضا',
          dataTable({
            caption: 'اعضای کسب‌وکار',
            columns: [{ key: 'name', label: 'نام' }, { key: 'role', label: 'نقش' }, { key: 'title', label: 'عنوان' }, { key: 'status', label: 'وضعیت' }],
            rows: rowsOf(members.json, 'members').map((member) => ({
              name: text(member['display_name']),
              role: ROLE_FA[text(member['role_key'])] ?? text(member['role_key']),
              title: text(member['job_title']),
              status: text(member['status']) === 'active' ? 'فعال' : text(member['status']),
            })),
            empty: 'هنوز عضوی نیست.',
          }),
        ),
        card(
          'دعوت‌های باز',
          invitations.status === 200
            ? dataTable({
                caption: 'دعوت‌نامه‌های باز',
                columns: [{ key: 'to', label: 'دعوت‌شده' }, { key: 'role', label: 'نقش' }, { key: 'expires', label: 'انقضا' }, { key: 'act', label: '' }],
                rows: rowsOf(invitations.json, 'invitations').map((invitation) => ({
                  to: text(invitation['invitee_display']),
                  role: ROLE_FA[text(invitation['role_key'])] ?? text(invitation['role_key']),
                  expires: shortDate(invitation['expires_at']),
                  act: actionForm({ action: '/app/team/revoke', csrf: ctx.csrf, label: 'باطل', hidden: { invitation_id: text(invitation['id']) }, tone: 'danger', ariaLabel: `باطل‌کردن دعوت ${text(invitation['invitee_display'])}` }),
                })),
                empty: 'دعوت بازی نیست.',
              })
            : emptyNote(describeProblem(invitations)),
        ),
        card(
          'دعوت عضو تازه',
          formBlock({
            id: 'invite',
            action: '/app/team/invite',
            csrf: ctx.csrf,
            fields: [
              { name: 'invitee', label: 'ایمیل یا موبایل', required: true, maxLength: 190, dir: 'ltr', hint: 'دعوت‌نامه یک‌بارمصرف است و منقضی می‌شود.' },
              { name: 'role', label: 'نقش', type: 'select', value: 'member', options: roleOptions },
              { name: 'message', label: 'پیام (اختیاری)', type: 'textarea', rows: 3, maxLength: 400 },
            ],
            submit: 'ارسال دعوت',
          }),
        ),
      ),
    };
  },
  actions: {
    async invite(ctx) {
      const invitee = (ctx.form?.['invitee'] ?? '').trim();
      const kind = invitee.includes('@') ? 'email' : 'phone';
      const body: Json = { invitee, invitee_kind: kind, role: ctx.form?.['role'] || 'member' };
      if ((ctx.form?.['message'] ?? '').trim() !== '') body['message'] = ctx.form?.['message'];
      return simple(ctx, () => ctx.api('POST', ctx.businessPath('/invitations'), body), '/app/team', 'دعوت‌نامه ساخته شد.');
    },
    async revoke(ctx) {
      const id = ctx.form?.['invitation_id'] ?? '';
      return simple(ctx, () => ctx.api('POST', ctx.businessPath(`/invitations/${encodeURIComponent(id)}/revoke`), {}), '/app/team', 'دعوت باطل شد.');
    },
  },
};

/* ------------------------------------------------------------------ ۴. محتوا */

function contentRows(items: Json[], ctx: PanelCtx, withSubmit: boolean): Array<Record<string, Cell>> {
  return items.map((item) => ({
    title: text(item['title']),
    kind: CONTENT_KIND_FA[text(item['kind'])] ?? text(item['kind']),
    status: statusBadge(text(item['status'])),
    updated: shortDate(item['updated_at']),
    act:
      withSubmit && ['draft', 'changes_requested'].includes(text(item['status']))
        ? actionForm({ action: '/app/content/submit', csrf: ctx.csrf, label: 'ارسال برای بازبینی', hidden: { id: text(item['id']) }, ariaLabel: `ارسال «${text(item['title'])}» برای بازبینی` })
        : '',
  }));
}

const content: Section = {
  key: 'content',
  title: 'محتوا',
  async render(ctx) {
    const status = ctx.url.searchParams.get('status') ?? '';
    const query = /^[a-z_]{3,20}$/.test(status) ? `?status=${status}` : '';
    const response = await ctx.api('GET', ctx.businessPath(`/content${query}`));
    if (response.status !== 200) return failure('محتوا', response);

    const filters = ['', ...Object.keys(CONTENT_STATUS_FA)].map((key) =>
      tag('a', { class: `chip${key === status ? ' chip--active' : ''}`, href: key ? `/app/content?status=${key}` : '/app/content', 'aria-current': key === status ? 'true' : null }, escapeText(key ? CONTENT_STATUS_FA[key] ?? key : 'همه')),
    );

    return {
      html: htmlOf(
        pageHeader('محتوا'),
        tag('nav', { 'aria-label': 'فیلتر وضعیت' }, tag('ul', {class: 'chips', role: 'list'}, filters.map((filter) => tag('li', {}, filter)).join(''))),
        card(
          'فهرست',
          dataTable({
            caption: 'محتوای کسب‌وکار',
            columns: [{ key: 'title', label: 'عنوان' }, { key: 'kind', label: 'نوع' }, { key: 'status', label: 'وضعیت' }, { key: 'updated', label: 'آخرین تغییر' }, { key: 'act', label: '' }],
            rows: contentRows(rowsOf(response.json, 'items'), ctx, true),
            empty: 'محتوایی با این وضعیت نیست.',
          }),
        ),
        card(
          'محتوای تازه',
          formBlock({
            id: 'create-content',
            action: '/app/content/create',
            csrf: ctx.csrf,
            fields: [
              { name: 'title', label: 'عنوان', required: true, maxLength: 300 },
              { name: 'slug', label: 'نامک (بخش نشانی)', required: true, maxLength: 72, dir: 'ltr', hint: 'حروف کوچک لاتین، رقم و خط‌تیره؛ بعداً قابل تغییر است.' },
              { name: 'kind', label: 'نوع', type: 'select', value: 'article', options: Object.entries(CONTENT_KIND_FA).map(([value, label]) => ({ value, label })) },
              { name: 'summary', label: 'خلاصه', type: 'textarea', rows: 3, maxLength: 600 },
            ],
            submit: 'ساخت پیش‌نویس',
          }),
        ),
      ),
    };
  },
  actions: {
    async create(ctx) {
      const form = ctx.form ?? {};
      const body: Json = { title: form['title'] ?? '', slug: form['slug'] ?? '', kind: form['kind'] ?? 'article' };
      if ((form['summary'] ?? '').trim() !== '') body['summary'] = form['summary'];
      return simple(ctx, () => ctx.api('POST', ctx.businessPath('/content'), body), '/app/content', 'پیش‌نویس ساخته شد.');
    },
    async submit(ctx) {
      const id = ctx.form?.['id'] ?? '';
      return simple(ctx, () => ctx.api('POST', ctx.businessPath(`/content/${encodeURIComponent(id)}/transition`), { to: 'in_review' }), '/app/content', 'برای بازبینی فرستاده شد.');
    },
  },
};

/* ------------------------------------------------------------------ ۵. بازبینی و تأیید */

const approvals: Section = {
  key: 'approvals',
  title: 'بازبینی و تأیید',
  async render(ctx) {
    const [review, approved] = await Promise.all([ctx.api('GET', ctx.businessPath('/content?status=in_review')), ctx.api('GET', ctx.businessPath('/content?status=approved'))]);
    if (review.status !== 200) return failure('بازبینی و تأیید', review);
    const decide = (item: Json, to: string, label: string, tone: 'primary' | 'danger' | 'ghost') =>
      actionForm({ action: '/app/approvals/decide', csrf: ctx.csrf, label, tone, hidden: { id: text(item['id']), to }, ariaLabel: `${label}: ${text(item['title'])}` });

    return {
      html: htmlOf(
        pageHeader('بازبینی و تأیید', { subtitle: 'محتوا فقط با گذر از بازبینی منتشر می‌شود (پیش‌نویس ← بازبینی ← تأیید ← انتشار).' }),
        card(
          'منتظر بازبینی',
          dataTable({
            caption: 'محتوای در بازبینی',
            columns: [{ key: 'title', label: 'عنوان' }, { key: 'kind', label: 'نوع' }, { key: 'updated', label: 'ارسال' }, { key: 'act', label: 'تصمیم' }],
            rows: rowsOf(review.json, 'items').map((item) => ({
              title: text(item['title']),
              kind: CONTENT_KIND_FA[text(item['kind'])] ?? text(item['kind']),
              updated: shortDate(item['updated_at']),
              act: raw(htmlOf(decide(item, 'approved', 'تأیید', 'primary'), decide(item, 'changes_requested', 'نیازمند اصلاح', 'ghost'))),
            })),
            empty: 'محتوایی منتظر بازبینی نیست.',
          }),
        ),
        card(
          'تأییدشده، آمادهٔ انتشار',
          approved.status === 200
            ? dataTable({
                caption: 'محتوای تأییدشده',
                columns: [{ key: 'title', label: 'عنوان' }, { key: 'updated', label: 'تأیید' }, { key: 'act', label: '' }],
                rows: rowsOf(approved.json, 'items').map((item) => ({ title: text(item['title']), updated: shortDate(item['updated_at']), act: decide(item, 'published', 'انتشار', 'primary') })),
                empty: 'محتوای تأییدشده‌ای نیست.',
              })
            : emptyNote(describeProblem(approved)),
        ),
      ),
    };
  },
  actions: {
    async decide(ctx) {
      const to = ctx.form?.['to'] ?? '';
      if (!['approved', 'changes_requested', 'published'].includes(to)) return back('/app/approvals', 'error', 'تصمیم نامعتبر است.');
      const id = ctx.form?.['id'] ?? '';
      const done = { approved: 'تأیید شد.', changes_requested: 'برای اصلاح برگردانده شد.', published: 'منتشر شد.' }[to] as string;
      return simple(ctx, () => ctx.api('POST', ctx.businessPath(`/content/${encodeURIComponent(id)}/transition`), { to }), '/app/approvals', done);
    },
  },
};

/* ------------------------------------------------------------------ ۶. رسانه */

const media: Section = {
  key: 'media',
  title: 'رسانه',
  async render(ctx) {
    const response = await ctx.api('GET', ctx.businessPath('/media'));
    if (response.status !== 200) return failure('رسانه', response);
    return {
      html: htmlOf(
        pageHeader('رسانه', { subtitle: 'بارگذاری فایل هنوز در دسترس نیست: مسیر آپلود امن (بررسی نوع واقعی فایل و سقف حجم، §74) در گام‌های بعد ساخته می‌شود.' }),
        card(
          'کتابخانه',
          dataTable({
            caption: 'دارایی‌های رسانه‌ای',
            columns: [{ key: 'name', label: 'نام' }, { key: 'kind', label: 'نوع' }, { key: 'size', label: 'حجم (کیلوبایت)' }, { key: 'dims', label: 'ابعاد' }, { key: 'alt', label: 'متن جایگزین' }],
            rows: rowsOf(response.json, 'assets').map((asset) => ({
              name: text(asset['original_name']) || text(asset['id']),
              kind: text(asset['detected_mime']),
              size: faNumber(Math.ceil(Number(asset['size_bytes'] ?? 0) / 1024)),
              dims: asset['width'] && asset['height'] ? `${faNumber(asset['width'])}×${faNumber(asset['height'])}` : '',
              alt: text(asset['alt_text']),
            })),
            empty: 'رسانه‌ای نیست.',
          }),
        ),
      ),
    };
  },
};

/* ------------------------------------------------------------------ ۷. سئو */

const seo: Section = {
  key: 'seo',
  title: 'سئو',
  async render(ctx) {
    const [audit, opportunities, redirects] = await Promise.all([
      ctx.api('GET', ctx.businessPath('/seo/audit')),
      ctx.api('GET', ctx.businessPath('/seo/opportunities')),
      ctx.api('GET', ctx.businessPath('/seo/redirects')),
    ]);
    if (redirects.status !== 200) return failure('سئو', redirects);
    const latest = audit.json?.['audit'] as Json | null | undefined;

    return {
      html: htmlOf(
        pageHeader('سئو', { subtitle: 'سئو در این سامانه داده است: قالب‌ها، فراداده و قاعده‌ها در پایگاه‌داده‌اند، نه در کد.' }),
        card(
          'آخرین بازرسی',
          latest
            ? definitionList([['امتیاز', latest['score'] === null ? '' : faNumber(latest['score'])], ['مانع', faNumber(latest['blocker_count'])], ['خطا', faNumber(latest['error_count'])], ['هشدار', faNumber(latest['warning_count'])], ['زمان', shortDate(latest['finished_at'] ?? latest['started_at'])]])
            : emptyNote('هنوز بازرسی‌ای اجرا نشده است.'),
        ),
        card(
          'فرصت‌ها',
          opportunities.status === 200
            ? dataTable({
                caption: 'فرصت‌های سئو',
                columns: [{ key: 'title', label: 'عنوان' }, { key: 'kind', label: 'نوع' }, { key: 'severity', label: 'اهمیت' }, { key: 'status', label: 'وضعیت' }],
                rows: rowsOf(opportunities.json, 'opportunities').map((row) => ({ title: text(row['title']), kind: text(row['kind']), severity: text(row['severity']), status: text(row['status']) })),
                empty: 'فرصت بازی نیست.',
              })
            : emptyNote(describeProblem(opportunities)),
        ),
        card(
          'تغییر مسیرها',
          dataTable({
            caption: 'قواعد تغییر مسیر',
            columns: [{ key: 'from', label: 'از' }, { key: 'to', label: 'به' }, { key: 'code', label: 'کد' }],
            rows: rowsOf(redirects.json, 'redirects').map((row) => ({ from: text(row['source_path']), to: text(row['target_path']), code: text(row['status_code']) })),
            empty: 'قاعده‌ای ثبت نشده است.',
          }),
        ),
        card(
          'قاعدهٔ تازه',
          formBlock({
            id: 'redirect',
            action: '/app/seo/redirect',
            csrf: ctx.csrf,
            fields: [
              { name: 'source_path', label: 'مسیر قدیم', required: true, dir: 'ltr', hint: 'با / شروع شود؛ مثل /old-page' },
              { name: 'target_path', label: 'مسیر تازه', required: true, dir: 'ltr' },
              { name: 'status_code', label: 'نوع', type: 'select', value: '301', options: [{ value: '301', label: '۳۰۱ — دائمی' }, { value: '302', label: '۳۰۲ — موقت' }, { value: '308', label: '۳۰۸ — دائمی (حفظ متد)' }, { value: '307', label: '۳۰۷ — موقت (حفظ متد)' }] },
            ],
            submit: 'ثبت قاعده',
          }),
        ),
      ),
    };
  },
  actions: {
    async redirect(ctx) {
      const form = ctx.form ?? {};
      const body = { source_path: form['source_path'] ?? '', target_path: form['target_path'] ?? '', status_code: Number(form['status_code'] ?? 301) };
      return simple(ctx, () => ctx.api('POST', ctx.businessPath('/seo/redirects'), body), '/app/seo', 'قاعده ثبت شد.');
    },
  },
};

/* ------------------------------------------------------------------ ۸. خودکارسازی */

const automation: Section = {
  key: 'automation',
  title: 'خودکارسازی',
  async render(ctx) {
    const [rules, health] = await Promise.all([ctx.api('GET', ctx.businessPath('/automation/rules')), ctx.api('GET', ctx.businessPath('/automation/health'))]);
    if (rules.status !== 200) return failure('خودکارسازی', rules);
    const h = (health.json?.['health'] ?? {}) as Json;

    return {
      html: htmlOf(
        pageHeader('خودکارسازی', { subtitle: 'قاعده = «وقتی رویدادی رخ داد، اگر شرط برقرار بود، کنش مجازی را انجام بده».' }),
        health.status === 200
          ? tag('div', { class: 'panel-metrics' }, [metricCard('قاعدهٔ فعال', faNumber(h['active_rules'])), metricCard('اجرا در ۲۴ ساعت', faNumber(h['runs_24h'])), metricCard('شکست در ۲۴ ساعت', faNumber(h['failures_24h'])), metricCard('اجرای گیرکرده', faNumber(h['stuck_runs']))].join(''))
          : '',
        card(
          'قاعده‌ها',
          dataTable({
            caption: 'قاعده‌های خودکارسازی',
            columns: [{ key: 'name', label: 'نام' }, { key: 'event', label: 'رویداد' }, { key: 'status', label: 'وضعیت' }, { key: 'act', label: '' }],
            rows: rowsOf(rules.json, 'rules').map((rule) => {
              const active = text(rule['status']) === 'active';
              return {
                name: text(rule['name']),
                event: text(rule['event_type']),
                status: raw(badgeFor(active ? 'فعال' : text(rule['status']) === 'paused' ? 'متوقف' : text(rule['status']), active ? 'success' : 'neutral')),
                act: actionForm({ action: '/app/automation/toggle', csrf: ctx.csrf, label: active ? 'توقف' : 'فعال‌سازی', hidden: { id: text(rule['id']), to: active ? 'paused' : 'active' }, ariaLabel: `${active ? 'توقف' : 'فعال‌سازی'} قاعدهٔ ${text(rule['name'])}` }),
              };
            }),
            empty: 'قاعده‌ای نیست. ساخت قاعده، با سازندهٔ No-Code (گام ۳۱) می‌آید.',
          }),
        ),
      ),
    };
  },
  actions: {
    async toggle(ctx) {
      const to = ctx.form?.['to'] ?? '';
      if (!['active', 'paused'].includes(to)) return back('/app/automation', 'error', 'وضعیت نامعتبر است.');
      const id = ctx.form?.['id'] ?? '';
      return simple(ctx, () => ctx.api('POST', ctx.businessPath(`/automation/rules/${encodeURIComponent(id)}/status`), { status: to }), '/app/automation', to === 'active' ? 'قاعده فعال شد.' : 'قاعده متوقف شد.');
    },
  },
};

/* ------------------------------------------------------------------ ۹. عملکرد */

const performance: Section = {
  key: 'performance',
  title: 'عملکرد',
  async render(ctx) {
    const [gate, regressions] = await Promise.all([ctx.api('GET', ctx.businessPath('/performance/gate')), ctx.api('GET', ctx.businessPath('/performance/regressions'))]);
    if (regressions.status !== 200) return failure('عملکرد', regressions);
    const verdict = text((gate.json?.['gate'] as Json | undefined)?.['verdict']);
    const blockers = Array.isArray((gate.json?.['gate'] as Json | undefined)?.['blockers']) ? (((gate.json?.['gate'] as Json)['blockers']) as Json[]) : [];

    return {
      html: htmlOf(
        pageHeader('عملکرد', { subtitle: 'انتشار بدون عبور از بودجهٔ عملکرد انجام نمی‌شود (§۹۶ Addendum).' }),
        card(
          'دروازهٔ انتشار',
          gate.status === 200
            ? htmlOf(
                tag('p', {}, `حکم: ${badgeFor(verdict === 'pass' ? 'قبول' : verdict === 'fail' ? 'رد' : verdict, verdict === 'pass' ? 'success' : 'danger')}`),
                dataTable({
                  caption: 'موانع و هشدارهای دروازه',
                  columns: [{ key: 'gate', label: 'بررسی' }, { key: 'severity', label: 'شدت' }, { key: 'message', label: 'توضیح' }],
                  rows: blockers.map((blocker) => ({ gate: text(blocker['gate']), severity: text(blocker['severity']), message: text(blocker['message']) })),
                  empty: 'مانعی نیست.',
                }),
              )
            : emptyNote(describeProblem(gate)),
        ),
        card(
          'پس‌رفت‌های باز',
          dataTable({
            caption: 'پس‌رفت‌های عملکرد',
            columns: [{ key: 'route', label: 'الگوی مسیر' }, { key: 'metric', label: 'سنجه' }, { key: 'severity', label: 'شدت' }, { key: 'delta', label: 'تغییر' }, { key: 'act', label: '' }],
            rows: rowsOf(regressions.json, 'regressions').map((row) => ({
              route: text(row['route_pattern']),
              metric: text(row['metric']),
              severity: text(row['severity']),
              delta: row['delta_ratio'] === null || row['delta_ratio'] === undefined ? '' : `${faNumber(Number(row['delta_ratio']) * 100)}٪`,
              act: actionForm({ action: '/app/performance/resolve', csrf: ctx.csrf, label: 'حل‌شده', hidden: { id: text(row['id']) }, ariaLabel: `علامت‌گذاری پس‌رفت ${text(row['route_pattern'])} به‌عنوان حل‌شده` }),
            })),
            empty: 'پس‌رفتی باز نیست.',
          }),
        ),
      ),
    };
  },
  actions: {
    async resolve(ctx) {
      const id = ctx.form?.['id'] ?? '';
      return simple(ctx, () => ctx.api('POST', ctx.businessPath(`/performance/regressions/${encodeURIComponent(id)}/resolve`), { status: 'resolved' }), '/app/performance', 'پس‌رفت حل‌شده علامت خورد.');
    },
  },
};

/* ------------------------------------------------------------------ ۱۰. روابط */

const relationships: Section = {
  key: 'relationships',
  title: 'روابط',
  async render(ctx) {
    const response = await ctx.api('GET', ctx.businessPath('/relationships'));
    if (response.status !== 200) return failure('روابط', response);
    return {
      html: htmlOf(
        pageHeader('روابط', { subtitle: 'ارتباط میان کسب‌وکارها: تأمین‌کننده، توزیع‌کننده، مشتری (§21).' }),
        card(
          'فهرست',
          dataTable({
            caption: 'روابط کسب‌وکار',
            columns: [{ key: 'kind', label: 'نوع رابطه' }, { key: 'name', label: 'کسب‌وکار' }, { key: 'status', label: 'وضعیت' }],
            rows: rowsOf(response.json, 'relationships').map((row) => ({ kind: text(row['kind']), name: text(row['other_name'] ?? row['name']), status: text(row['status']) })),
            empty: 'رابطه‌ای ثبت نشده است. مدیریت روابط از طریق API ممکن است؛ رابط آن در این نسخه نیست.',
          }),
        ),
      ),
    };
  },
};

/* ------------------------------------------------------------------ ۱۱. یکپارچه‌سازی (کلید API) */

const SCOPE_PRESETS: Readonly<Record<string, readonly string[]>> = {
  read: ['profile.view'],
  content: ['profile.view', 'content.update'],
};

const integrations: Section = {
  key: 'integrations',
  title: 'یکپارچه‌سازی',
  async render(ctx) {
    const response = await ctx.api('GET', '/api/v1/auth/api-keys');
    if (response.status !== 200) return failure('یکپارچه‌سازی', response);
    return {
      html: htmlOf(
        pageHeader('یکپارچه‌سازی', { subtitle: 'کلید API برای سامانه‌های شما. مقدار کامل کلید فقط یک‌بار، هنگام ساخت، نشان داده می‌شود.' }),
        card(
          'کلیدها',
          dataTable({
            caption: 'کلیدهای API',
            columns: [{ key: 'name', label: 'نام' }, { key: 'prefix', label: 'پیشوند' }, { key: 'scopes', label: 'دامنه' }, { key: 'used', label: 'آخرین استفاده' }, { key: 'status', label: 'وضعیت' }, { key: 'act', label: '' }],
            rows: rowsOf(response.json, 'keys').map((key) => ({
              name: text(key['name']),
              prefix: raw(tag('code', { dir: 'ltr' }, escapeText(text(key['key_prefix'])))),
              scopes: Array.isArray(key['scopes']) ? (key['scopes'] as string[]).join('، ') : '',
              used: shortDate(key['last_used_at']),
              status: key['revoked_at'] ? raw(badgeFor('باطل‌شده', 'danger')) : raw(badgeFor('فعال', 'success')),
              act: key['revoked_at'] ? '' : actionForm({ action: '/app/integrations/revoke', csrf: ctx.csrf, label: 'باطل', tone: 'danger', hidden: { id: text(key['id']) }, ariaLabel: `باطل‌کردن کلید ${text(key['name'])}` }),
            })),
            empty: 'کلیدی ساخته نشده است.',
          }),
        ),
        card(
          'کلید تازه',
          formBlock({
            id: 'new-key',
            action: '/app/integrations/create',
            csrf: ctx.csrf,
            fields: [
              { name: 'name', label: 'نام کلید', required: true, maxLength: 80 },
              { name: 'preset', label: 'دامنهٔ دسترسی', type: 'select', value: 'read', options: [{ value: 'read', label: 'فقط خواندن پروفایل' }, { value: 'content', label: 'پروفایل و ویرایش محتوا' }] },
            ],
            submit: 'ساخت کلید',
          }),
        ),
      ),
    };
  },
  actions: {
    async create(ctx) {
      const preset = ctx.form?.['preset'] ?? 'read';
      const scopes = SCOPE_PRESETS[preset];
      if (!scopes) return back('/app/integrations', 'error', 'دامنهٔ نامعتبر است.');
      const response = await ctx.api('POST', '/api/v1/auth/api-keys', { name: ctx.form?.['name'] ?? '', scopes });
      if (response.status !== 201) return back('/app/integrations', 'error', describeProblem(response));
      const secret = text(response.json?.['secret']);
      // نمایش مستقیم، بی‌هدایت و بی‌کوکی: راز یک‌بار دیده می‌شود و هیچ‌جا (لاگ، کوکی، تاریخچه) نمی‌ماند.
      return {
        page: {
          title: 'کلید ساخته شد',
          html: htmlOf(
            pageHeader('کلید ساخته شد'),
            card(
              'این مقدار را همین حالا کپی کنید',
              htmlOf(
                tag('p', {}, escapeText('دیگر هرگز نمایش داده نمی‌شود. اگر گم شد، کلید را باطل و کلید تازه بسازید.')),
                tag('pre', { class: 'secret', dir: 'ltr' }, tag('code', {}, escapeText(secret))),
                tag('p', {}, tag('a', { class: 'button button--primary', href: '/app/integrations' }, 'بازگشت به کلیدها')),
              ),
            ),
          ),
        },
      };
    },
    async revoke(ctx) {
      const id = ctx.form?.['id'] ?? '';
      return simple(ctx, () => ctx.api('DELETE', `/api/v1/auth/api-keys/${encodeURIComponent(id)}`), '/app/integrations', 'کلید باطل شد.');
    },
  },
};

/* ------------------------------------------------------------------ ۱۲. اعلان‌ها */

const notifications: Section = {
  key: 'notifications',
  title: 'اعلان‌ها',
  async render(ctx) {
    const response = await ctx.api('GET', '/api/v1/ops/notifications');
    if (response.status !== 200) return failure('اعلان‌ها', response);
    return {
      html: htmlOf(
        pageHeader('اعلان‌ها', { subtitle: `${faNumber(response.json?.['unread'])} اعلان نخوانده` }),
        card(
          'پیام‌ها',
          dataTable({
            caption: 'اعلان‌های شما',
            columns: [{ key: 'title', label: 'عنوان' }, { key: 'body', label: 'متن' }, { key: 'at', label: 'زمان' }, { key: 'act', label: '' }],
            rows: rowsOf(response.json, 'notifications').map((row) => ({
              title: text(row['title']),
              body: text(row['body']),
              at: shortDate(row['created_at']),
              act: row['read_at'] ? raw(badgeFor('خوانده', 'neutral')) : actionForm({ action: '/app/notifications/read', csrf: ctx.csrf, label: 'خواندم', hidden: { id: text(row['id']) }, ariaLabel: `علامت‌گذاری «${text(row['title'])}» به‌عنوان خوانده` }),
            })),
            empty: 'اعلانی نیست.',
          }),
        ),
      ),
    };
  },
  actions: {
    async read(ctx) {
      const id = ctx.form?.['id'] ?? '';
      return simple(ctx, () => ctx.api('POST', `/api/v1/ops/notifications/${encodeURIComponent(id)}/read`, {}), '/app/notifications', 'علامت خورد.');
    },
  },
};

/* ------------------------------------------------------------------ ۱۳. حساب و امنیت */

const account: Section = {
  key: 'account',
  title: 'حساب و امنیت',
  async render(ctx) {
    const codes = await ctx.api('GET', '/api/v1/auth/recovery-codes');
    return {
      html: htmlOf(
        pageHeader('حساب و امنیت'),
        card('حساب', definitionList([['نام', ctx.session.displayName], ['کسب‌وکارهای عضو', faNumber(ctx.session.businesses.length)], ['نقش پلتفرمی', ctx.session.platformRole ? 'کارمند پلتفرم' : 'ندارید']])),
        card(
          'کدهای بازیابی',
          codes.status === 200
            ? htmlOf(tag('p', {}, `${faNumber(codes.json?.['remaining'])} کد بازیابی باقی مانده است.`), tag('p', { class: 'field__hint' }, 'ساخت کد تازه و ورود دومرحله‌ای، پس از آماده‌شدن رابط احراز مجدد فعال می‌شود؛ هیچ کدِ ساختگی نمایش داده نمی‌شود.'))
            : emptyNote(describeProblem(codes)),
        ),
        card('نشست', tag('p', {}, escapeText('کوکی نشست فقط برای همین سایت معتبر است، از جاوااسکریپت خوانده نمی‌شود و به زیردامنه‌های دیگر نمی‌رود (§۱۱).')) + actionForm({ action: '/logout', csrf: ctx.csrf, label: 'خروج از این نشست', tone: 'danger' }).__html),
      ),
    };
  },
};

/* ------------------------------------------------------------------ ۱۴. تنظیمات کسب‌وکار */

const settings: Section = {
  key: 'settings',
  title: 'تنظیمات کسب‌وکار',
  async render(ctx) {
    const response = await ctx.api('GET', ctx.businessPath('/overview'));
    if (response.status !== 200) return failure('تنظیمات کسب‌وکار', response);
    const business = (response.json?.['business'] ?? {}) as Json;
    return {
      html: htmlOf(
        pageHeader('تنظیمات کسب‌وکار'),
        card(
          'مشخصات پایه',
          formBlock({
            id: 'settings',
            action: '/app/settings/save',
            csrf: ctx.csrf,
            fields: [
              { name: 'expected_version', type: 'hidden', label: '', value: text(business['version']) },
              { name: 'name', label: 'نام', required: true, value: text(business['name']), maxLength: 120 },
              { name: 'name_latin', label: 'نام لاتین', value: text(business['name_latin']), maxLength: 120, dir: 'ltr' },
              { name: 'visibility', label: 'نمایش در سایت عمومی', type: 'select', value: text(business['visibility']), options: [{ value: 'public', label: 'عمومی' }, { value: 'private', label: 'خصوصی' }], hint: 'انتشار عمومی، تصمیم جداگانهٔ شماست؛ وجود رکورد، آن را عمومی نمی‌کند (§۲۲).' },
            ],
            submit: 'ذخیره',
          }),
        ),
        card('وضعیت', definitionList([['وضعیت', text(business['status'])], ['تأیید', text(business['verification_level'])], ['نشانی عمومی', business['slug'] ? raw(tag('a', { href: `${ctx.publicOrigin}/b/${encodeURIComponent(text(business['slug']))}` }, escapeText(`/b/${text(business['slug'])}`))) : '']])),
      ),
    };
  },
  actions: {
    async save(ctx) {
      const form = ctx.form ?? {};
      const version = Number(form['expected_version']);
      if (!Number.isInteger(version) || version < 1) return back('/app/settings', 'error', 'نسخهٔ فرم نامعتبر است؛ صفحه را تازه کنید.');
      const body: Json = { expected_version: version, name: form['name'] ?? '' };
      if ((form['name_latin'] ?? '').trim() !== '') body['name_latin'] = form['name_latin'];
      if (['public', 'private'].includes(form['visibility'] ?? '')) body['visibility'] = form['visibility'];
      return simple(ctx, () => ctx.api('PATCH', ctx.businessPath(), body), '/app/settings', 'تنظیمات ذخیره شد.');
    },
  },
};

export const MEMBER_SECTIONS: SectionRegistry = {
  dashboard,
  pages:pagesSection,
  profile,
  team,
  content,
  approvals,
  media,
  seo,
  automation,
  performance,
  relationships,
  integrations,
  notifications,
  account:secureAccount(account),
  settings,
};
