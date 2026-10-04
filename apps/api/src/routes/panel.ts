/**
 * مسیرهای پنل (گام ۲۸؛ §15، §26–۲۸، §103).
 *
 * دو مسیر، هر دو «داده را می‌سازند»، نه مجوز می‌دهند:
 *
 *   • `GET /panel/menu` — منوی مجازِ بازیگر، از `ops.menu_item` (داده). پنهان‌کردن منو، مجوز دادن نیست
 *     (§15): هر صفحه مجوزش را دوباره از API می‌گیرد.
 *   • `GET /panel/dashboard` — ویجت‌های داشبورد **به تفکیک نوع کسب‌وکار** (§27)، از `ref.dashboard_widget`.
 *     «از داده، نه از شرط در کد»: این‌جا هیچ `if (type === 'clinic')` نیست؛ فقط جدول.
 *
 * `source` ویجت از فهرست بستهٔ منبع‌هاست (CHECK در پایگاه‌داده) و برای هر منبع **یک خواندنِ مجازشده** در
 * این فایل هست. داده، SQL یا کد نمی‌آورد (§74). و هر منبع، مجوز خودش را دارد: بازیگری که حق دیدن
 * داده‌ای را ندارد، ویجتش را **نمی‌بیند** (نه اینکه «۰» ببیند؛ «۰» دروغ است).
 */

import { AppError } from '@petavu/shared';

import type { RouteDefinition, Scope } from '../types.js';

type WidgetSource = 'completeness' | 'content_counts' | 'team' | 'invitations' | 'listings' | 'notifications' | 'automation' | 'regressions';

interface WidgetValue {
  readonly value: number;
  readonly items?: ReadonlyArray<{ readonly key: string; readonly count: number }>;
}

/** مجوزِ دیدن داده‌ی هر منبع؛ `null` ⇒ هر عضو. */
const SOURCE_PERMISSION: Readonly<Record<WidgetSource, string | null>> = {
  completeness: 'profile.view',
  content_counts: 'content.update',
  team: null,
  invitations: 'business.member.manage',
  listings: 'profile.view',
  notifications: null,
  automation: 'automation.manage',
  regressions: 'business.analytics.view',
};

async function resolveSource(source: WidgetSource, businessId: string, scope: Scope): Promise<WidgetValue> {
  switch (source) {
    case 'completeness': {
      const [row] = await scope.query<{ value: number }>('select profile_completeness::int as value from app.business where id = $1', [businessId]);
      return { value: Number(row?.value ?? 0) };
    }
    case 'content_counts': {
      const rows = await scope.query<{ status: string; n: number }>(
        `select status, count(*)::int as n from app.content where business_id = $1 and deleted_at is null group by status order by status`,
        [businessId],
      );
      return { value: rows.reduce((sum, row) => sum + Number(row.n), 0), items: rows.map((row) => ({ key: row.status, count: Number(row.n) })) };
    }
    case 'team': {
      const [row] = await scope.query<{ value: number }>('select app.active_member_count($1) as value', [businessId]);
      return { value: Number(row?.value ?? 0) };
    }
    case 'invitations': {
      const [row] = await scope.query<{ value: number }>(
        `select count(*)::int as value from app.invitation
          where business_id = $1 and accepted_at is null and rejected_at is null and revoked_at is null and expires_at > now()`,
        [businessId],
      );
      return { value: Number(row?.value ?? 0) };
    }
    case 'listings': {
      const [row] = await scope.query<{ value: number }>('select listing_count::int as value from app.business where id = $1', [businessId]);
      return { value: Number(row?.value ?? 0) };
    }
    case 'notifications': {
      const [row] = await scope.query<{ value: number }>(
        `select count(*)::int as value from ops.notification where recipient_user_id = app.current_user_id() and read_at is null`,
      );
      return { value: Number(row?.value ?? 0) };
    }
    case 'automation': {
      const health = (await scope.repos.automation.health(businessId)) as Record<string, unknown>;
      const items = ['active_rules', 'runs_24h', 'failures_24h', 'stuck_runs'].map((key) => ({ key, count: Number(health[key] ?? 0) }));
      return { value: Number(health['failures_24h'] ?? 0), items };
    }
    case 'regressions': {
      const rows = await scope.repos.performance.regressions('open');
      return { value: rows.length };
    }
  }
}

export const panelRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/v1/panel/menu',
    name: 'panel.menu',
    summary: 'منوی مجازِ بازیگر برای یک سطح (از داده)',
    tags: ['panel'],
    auth: 'session',
    role: 'pv_app',
    handler: async (request, scope) => {
      const surface = request.query.get('surface') ?? 'panel';
      if (!['panel','admin','shop','admin_shop'].includes(surface)) {
        throw new AppError('validation_failed', { details: { issues: [{ path: 'surface', code: 'not_allowed', allowed: ['panel', 'admin','shop','admin_shop'] }] } });
      }
      const items = await scope.query('select key, label_fa, path, icon_key, availability, planned_step, description from app.panel_menu($1)', [surface]);
      return { body: { surface, items } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/panel/dashboard',
    name: 'panel.dashboard',
    summary: 'ویجت‌های داشبورد متناسب با نوع کسب‌وکار فعال',
    tags: ['panel'],
    auth: 'session',
    role: 'pv_app',
    handler: async (request, scope) => {
      const businessId = request.businessId;
      if (!businessId) return { body: { business: null, widgets: [] } };

      // عضویت: بی‌عضو، «پیدا نشد» می‌گیرد (وجود کسب‌وکار افشا نمی‌شود، §14).
      const [member] = await scope.query<{ ok: boolean }>('select app.is_member_of($1) as ok', [businessId]);
      if (member?.ok !== true) throw new AppError('not_found', { details: { reason: 'not_a_member' } });

      const [business] = await scope.query<{ id: string; name: string; business_type_key: string; type_name: string | null; status: string }>(
        `select b.id, b.name, b.business_type_key, t.name_fa as type_name, b.status
           from app.business b left join ref.business_type t on t.key = b.business_type_key
          where b.id = $1`,
        [businessId],
      );
      if (!business) throw new AppError('not_found');

      const defined = await scope.query<{ key: string; name_fa: string; kind: string; source: WidgetSource }>(
        `select w.key, w.name_fa, w.kind, w.source
           from ref.dashboard_widget w
          where w.is_active and (w.business_type_keys is null or $1 = any (w.business_type_keys))
          order by w.sort_order, w.key`,
        [business.business_type_key],
      );

      const widgets: Array<Record<string, unknown>> = [];
      for (const widget of defined) {
        const required = SOURCE_PERMISSION[widget.source];
        if (required) {
          const [allowed] = await scope.query<{ ok: boolean }>('select app.has_permission($1, $2) as ok', [businessId, required]);
          if (allowed?.ok !== true) continue; // حق دیدن ندارد ⇒ ویجت نیست (نه «۰»)
        }
        widgets.push({ key: widget.key, name_fa: widget.name_fa, kind: widget.kind, source: widget.source, ...(await resolveSource(widget.source, businessId, scope)) });
      }

      return { body: { business, widgets } };
    },
  },
];
