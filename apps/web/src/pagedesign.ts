import {buildBusinessView} from '@petavu/design/businesscontext';
export {buildBusinessView,formatHours,contactHref} from '@petavu/design/businesscontext';
import {isUuid} from '@petavu/shared';
import type {FormSchemaView} from '@petavu/design/nocode';
import {createRegistry} from './registry.js';
/**
 * اتصال صفحه‌ها به درخت طراحی (گام ۲۳؛ §35–۳۸، §103، §161–۱۶۹).
 *
 * این ماژول **تنها** جایی است که «صفحهٔ کدنوشته» و «صفحهٔ ساخته‌شده از درخت»
 * به هم می‌رسند. سه قاعده:
 *
 *   ۱. **درخت منتشرشده، حاکم است.** اگر صفحهٔ منتشرشده‌ای برای این کلید وجود
 *      داشته باشد، همان رندر می‌شود. اگر نباشد، صفحه به چیدمان پایهٔ کد
 *      برمی‌گردد — نه به یک صفحهٔ خالی.
 *   ۲. **داده، پس از پیش‌اسکن خوانده می‌شود.** تا وقتی ندانیم درخت به فهرست
 *      کسب‌وکار یا محتوا نیاز دارد، آن را نمی‌خوانیم (Addendum §۲۰: پرهیز از
 *      خواندن بی‌مصرف و N+1).
 *   ۳. **هر یافته، لاگ می‌شود.** «کامپوننتی رندر نشد» یا «پراپی دور ریخته شد»
 *      باید در مشاهده‌پذیری دیده شود، وگرنه سکوت، خرابی پنهان می‌سازد.
 */

import type { Logger } from '@petavu/shared';

import { mediaViewOf, type MediaAssetRow } from './media.js';
import { findingsDigest, type Finding } from './registry.js';
import { renderTree, scanTree, type TreeNeed } from './tree.js';
import type {
  BusinessCardView,
  ContentCardView,
  MediaView,
  TreeData,
} from './renderers.js';
import type { BusinessContactRow, BusinessLocationRow, ContentIndexRow, PublicBusinessRow } from './data.js';
import type { PageContext } from './pages/types.js';

export interface DesignPageInput {
  readonly context: PageContext;
  /** `null` ⇒ صفحهٔ سراسری پلتفرم (مثل صفحهٔ اصلی). */
  readonly businessId: string | null;
  /** کلید صفحه در `design.page` — `home`, `about`, … */
  readonly key: string;
  /** متن‌های زمینه برای نگه‌دارنده‌ها: `{business_name}`, `{tagline}`, … */
  readonly strings: Readonly<Record<string, string>>;
  /** نشانی مطلق این صفحه (برای اشتراک‌گذاری و لینک‌های ساخت‌یافته). */
  readonly pageUrl: string;
  /** ردیف کسب‌وکار، اگر صفحه در بافت کسب‌وکار است. */
  readonly business?: PublicBusinessRow | null;
  /** سقف اعضای فهرست‌های داده‌محور. */
  readonly listLimit?: number;
}

export interface DesignPageResult {
  /** `null` ⇒ درختی منتشر نشده بود؛ صفحه باید چیدمان پایه را بریزد. */
  readonly html: string | null;
  /** آیا درخت، `h1` خودش را داشت؟ (نبودش ⇒ صفحه باید عنوان پایه بگذارد.) */
  readonly hasH1: boolean;
  readonly weightKb: number;
  readonly findings: readonly Finding[];
  readonly used: boolean;
  readonly hasForms?:boolean;
}

const NO_TREE: DesignPageResult = { html: null, hasH1: false, weightKb: 0, findings: [], used: false };

export async function renderDesignPage(input: DesignPageInput): Promise<DesignPageResult> {
  const { context } = input;
  const requestId = context.requestId;
  const frozenRegistry=await context.data.pageRegistry({businessId:input.businessId,key:input.key},requestId);
  const registry = frozenRegistry ? createRegistry(frozenRegistry) : context.registry;

  /*
   * Registry نبود ⇒ درخت رندر نمی‌شود. این «خرابی» نیست، «فقدان ظرفیت» است:
   * صفحه به چیدمان پایه برمی‌گردد و همان کار می‌کند.
   */
  if (!registry || registry.size === 0) {
    return NO_TREE;
  }

  const raw = await context.data.pageTree({ businessId: input.businessId, key: input.key }, requestId);
  if (raw === null) return NO_TREE;

  const scan = scanTree(raw, { registry, strings: input.strings });

  const [data, media] = await Promise.all([
    loadTreeData(input, scan.needs),
    loadMedia(input, scan.assetIds),
  ]);

  const forms=new Map<string,FormSchemaView>();if(scan.needs.has('forms'))for(const form of await context.data.publicForms(input.businessId,requestId)){forms.set(form.form.id,form);forms.set(String(form.form.spec['purpose']),form);}
  const records=new Map<string,Array<{title:string;url:string}>>();const visit=(nodes:typeof scan.nodes)=>{for(const n of nodes){if(n.component==='data.crud_list'&&isUuid(n.props['definitionId']))records.set(n.props['definitionId'],[]);for(const values of Object.values(n.slots))visit(values);}};visit(scan.nodes);for(const id of records.keys()){const values=await context.data.publicRecords(id,input.businessId,requestId);records.set(id,values.map(v=>({title:v.title,url:v.business_slug?`/b/${encodeURIComponent(v.business_slug)}/c/${encodeURIComponent(v.slug)}`:`/${encodeURIComponent(v.slug)}`})));}
  const rendered = renderTree({
    scan,
    registry,
    strings: input.strings,
    data:{...data,forms,records},
    pageUrl: input.pageUrl,
    locale: context.settings?.default_locale ?? 'fa-IR',
    media: media.size === 0 ? null : (assetId) => media.get(assetId) ?? null,
    images: context.images,
  });

  logFindings(context.logger, input.key, requestId, rendered.findings, {
    nodes: rendered.renderedNodes,
    weightKb: rendered.weightKb,
    skipped: rendered.skipped,
  });

  if (rendered.html.trim() === '') {
    context.logger.warn('درخت طراحی چیزی برای رندر نداشت؛ چیدمان پایه اجرا می‌شود', {
      requestId,
      pageKey: input.key,
      skipped: rendered.skipped,
    });
    return { ...NO_TREE, findings: rendered.findings };
  }

  return {
    html: rendered.html,
    hasH1: rendered.hasH1,
    weightKb: rendered.weightKb,
    findings: rendered.findings,
    used: true,
    hasForms: scan.needs.has('forms'),
  };
}

async function loadTreeData(input: DesignPageInput, needs: ReadonlySet<TreeNeed>): Promise<TreeData> {
  const { context } = input;
  const limit = input.listLimit ?? 6;

  const [businesses, contents, businessContext] = await Promise.all([
    needs.has('businesses')
      ? context.data.featuredBusinesses(limit, context.requestId)
      : Promise.resolve([] as PublicBusinessRow[]),
    needs.has('contents') ? context.data.contentIndex(limit, context.requestId) : Promise.resolve([] as ContentIndexRow[]),
    needs.has('business') && input.businessId
      ? context.data.businessContext(input.businessId, context.requestId)
      : Promise.resolve({ locations: [] as BusinessLocationRow[], contacts: [] as BusinessContactRow[] }),
  ]);

  return {
    businesses: businesses.map(toBusinessCard),
    contents: contents.map(toContentCard),
    business: input.business
      ? buildBusinessView(input.business, businessContext.locations, businessContext.contacts, context.config.env.origins.public)
      : null,
  };
}

async function loadMedia(input: DesignPageInput, assetIds: readonly string[]): Promise<Map<string, MediaView>> {
  const map = new Map<string, MediaView>();
  if (assetIds.length === 0) return map;

  const rows = await input.context.data.mediaAssets(assetIds, input.context.requestId);
  for (const row of rows as MediaAssetRow[]) {
    const view = mediaViewOf(row);
    if (view) map.set(row.id, view);
  }

  const missing = assetIds.filter((id) => !map.has(id));
  if (missing.length > 0) {
    input.context.logger.warn('دارایی رسانه‌ای قابل‌استفاده نبود', {
      requestId: input.context.requestId,
      requested: assetIds.length,
      unusable: missing.length,
    });
  }

  return map;
}

function toBusinessCard(row: PublicBusinessRow): BusinessCardView {
  return {
    name: row.name,
    url: `/b/${row.slug}`,
    summary: row.summary ?? row.tagline,
    cityName: row.city_name,
  };
}

function toContentCard(row: ContentIndexRow): ContentCardView {
  return {
    title: row.title,
    url: row.business_slug ? `/b/${encodeURIComponent(row.business_slug)}/c/${encodeURIComponent(row.slug)}` : `/${encodeURIComponent(row.slug)}`,
    summary: null,
    publishedAt: row.published_at ?? null,
  };
}

/* ------------------------------------------------------------------ بافت کسب‌وکار */

/* ------------------------------------------------------------------ لاگ */

function logFindings(
  logger: Logger,
  pageKey: string,
  requestId: string,
  findings: readonly Finding[],
  context: Readonly<Record<string, unknown>>,
): void {
  if (findings.length === 0) return;

  const blockers = findings.filter((finding) => finding.severity === 'blocker').length;
  const record = {
    requestId,
    pageKey,
    count: findings.length,
    blockers,
    digest: findingsDigest(findings),
    ...context,
  };

  if (blockers > 0) logger.warn('یافته‌های مسدودکننده در درخت صفحه', record);
  else logger.debug('یافته‌های درخت صفحه', record);
}
