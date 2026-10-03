/**
 * ثبت یافته‌های خزش پیوند در `seo.content_opportunity` (گام ۲۶؛ Addendum §۴۴–۴۶).
 *
 * سه قاعده که این ماژول را ساخت:
 *
 *   ۱) **ایدمپوتنت.** اجرای دوبارهٔ خزش، هر بار ردیف تازه نمی‌سازد. یکتایی جزئی روی
 *      `(kind, path)` برای فرصت‌های «باز» (مهاجرت ۰۰۲۱) همین را در پایگاه‌داده
 *      تضمین می‌کند؛ این‌جا فقط `on conflict … do update` است (§180).
 *   ۲) **خودبسته‌شونده.** صفحه‌ای که دیگر یتیم نیست، فرصتش «انجام‌شده» می‌شود — بی‌دست
 *      انسان. فقط فرصت‌های `open` بسته می‌شوند؛ `planned` و `in_progress` کار آدمی‌اند
 *      و خزش به آن‌ها دست نمی‌زند.
 *   ۳) **پیشنهاد، نه فقط گلایه.** برای کسب‌وکارِ یتیم، سه کسب‌وکار هم‌نوع پیشنهاد
 *      می‌شود که به آن پیوند بدهند (همان چرخش پایدار صفحهٔ پروفایل).
 */

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const HUB_OF_PREFIX = { b: '/businesses', t: '/t', i: '/i', l: '/l', k: '/k' };

export function entityKindOf(path) {
  const prefix = path.split('/')[1];
  switch (prefix) {
    case 'b':
      return 'business';
    case 't':
      return 'business_type';
    case 'i':
      return 'industry';
    case 'l':
      return 'location';
    case 'k':
      return 'category';
    default:
      return path === '/' || ['/businesses', '/t', '/i', '/l', '/k'].includes(path) ? 'listing' : 'content';
  }
}

async function suggestionFor(engine, path) {
  if (path.startsWith('/b/')) {
    const slug = path.slice(3);
    const siblings = await engine.query(
      `select s.slug
         from app.business b
         join app.business s on s.business_type_key = b.business_type_key and s.id <> b.id
          and s.status = 'active' and s.visibility = 'public' and s.deleted_at is null
        where b.slug = $1
        order by md5(s.id::text || b.id::text)
        limit 3`,
      [slug],
    );
    if (siblings.length > 0) {
      return { action: 'add_internal_link', from_paths: siblings.map((row) => `/b/${row.slug}`), note: 'پیوند از کسب‌وکارهای هم‌نوع' };
    }
  }
  const hub = HUB_OF_PREFIX[path.split('/')[1]];
  return { action: 'link_from_hub', from_paths: hub ? [hub] : ['/'], note: 'پیوند از مرکز یا صفحهٔ مرتبط' };
}

async function upsert(engine, row) {
  const result = await engine.query(
    `insert into seo.content_opportunity
       (business_id, kind, severity, title, description, entity_kind, path, priority, evidence, suggested_action, status)
     values (null, $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 'open')
     on conflict (kind, (coalesce(path, '')), (coalesce(business_id, '${NIL_UUID}'::uuid)))
       where status in ('open', 'planned', 'in_progress')
     do update set evidence = excluded.evidence, suggested_action = excluded.suggested_action,
                   severity = excluded.severity, detected_at = now()
     returning (xmax = 0) as inserted`,
    [
      row.kind,
      row.severity,
      row.title,
      row.description,
      row.entityKind,
      row.path,
      row.priority,
      JSON.stringify(row.evidence),
      JSON.stringify(row.suggested),
    ],
  );
  return result[0]?.inserted === true;
}

/**
 * @param engine  موتور پایگاه‌داده (`openDatabase`)
 * @param graph   خروجی `crawlLinkGraph`
 * @returns       `{ opened, updated, closed }` به تفکیک نوع
 */
export async function recordLinkFindings(engine, graph) {
  const summary = {
    orphan_page: { opened: 0, updated: 0, closed: 0 },
    broken_link: { opened: 0, updated: 0, closed: 0 },
  };

  // ---- صفحه‌های یتیم
  for (const path of graph.orphans) {
    const inserted = await upsert(engine, {
      kind: 'orphan_page',
      severity: 'medium',
      title: `صفحهٔ یتیم: ${path}`,
      description: 'هیچ صفحهٔ دیگری در بدنهٔ اصلی یا مسیر راهنمایش به این صفحه پیوند نمی‌دهد (پیوندِ سرصفحه و پاورقی نمی‌شمارد).',
      entityKind: entityKindOf(path),
      path,
      priority: 50,
      evidence: { inbound: 0, crawled_at: new Date().toISOString() },
      suggested: await suggestionFor(engine, path),
    });
    summary.orphan_page[inserted ? 'opened' : 'updated'] += 1;
  }

  // ---- پیوند شکسته: به‌ازای مقصد، با فهرست مبدأها
  const byTarget = new Map();
  for (const link of graph.broken) {
    const entry = byTarget.get(link.to) ?? { status: link.status, sources: [] };
    entry.sources.push(link.from);
    byTarget.set(link.to, entry);
  }
  for (const unhealthy of graph.unhealthyNodes) {
    const entry = byTarget.get(unhealthy.path) ?? { status: unhealthy.status, sources: [] };
    entry.sources.push('sitemap');
    byTarget.set(unhealthy.path, entry);
  }
  for (const [target, entry] of byTarget) {
    const inserted = await upsert(engine, {
      kind: 'broken_link',
      severity: 'high',
      title: `پیوند شکسته: ${target} (${entry.status})`,
      description: 'نشانی‌ای که در سایت (یا نقشهٔ سایت) به آن پیوند داده شده، پاسخ سالم نمی‌دهد.',
      entityKind: entityKindOf(target),
      path: target,
      priority: 80,
      evidence: { status: entry.status, sources: [...new Set(entry.sources)].slice(0, 10), crawled_at: new Date().toISOString() },
      suggested: { action: 'fix_or_remove_link', note: 'پیوند را اصلاح کنید یا بردارید؛ یا تغییر مسیر ۳۰۱ ثبت کنید.' },
    });
    summary.broken_link[inserted ? 'opened' : 'updated'] += 1;
  }

  // ---- خودبستن: هرچه باز بود و دیگر دیده نمی‌شود
  const stillOrphan = [...graph.orphans];
  const stillBroken = [...byTarget.keys()];
  for (const [kind, current] of [
    ['orphan_page', stillOrphan],
    ['broken_link', stillBroken],
  ]) {
    const closed = await engine.query(
      `update seo.content_opportunity
          set status = 'done', resolved_at = now()
        where business_id is null and kind = $1 and status = 'open' and path <> all($2::text[])
        returning id`,
      [kind, current],
    );
    summary[kind].closed = closed.length;
  }

  return summary;
}
