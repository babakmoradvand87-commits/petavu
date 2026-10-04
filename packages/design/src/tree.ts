/**
 * درخت صفحه: تجزیه، پیش‌اسکن، رندر (گام ۲۳؛ §32–۴۴، §161–۱۶۹، §103).
 *
 * درخت JSON در `design.page.published_tree` **داده** است، نه کد. سه مرحله دارد:
 *
 *   ۱. **تجزیه** (`parseTree`) — شکل درخت سنجیده می‌شود: هر گره باید کامپوننت
 *      شناخته‌شدهٔ Registry باشد، شناسهٔ یگانه داشته باشد، و از سقف عمق و تعداد
 *      نگذرد. گرهٔ نامعتبر **حذف** می‌شود، نه اینکه خطا بدهد: صفحهٔ عمومی هرگز
 *      به‌خاطر یک گرهٔ خراب ۵۰۰ نمی‌دهد — ولی یافته‌اش ثبت می‌شود.
 *   ۲. **پیش‌اسکن** (`scanTree`) — پیش از رندر می‌دانیم صفحه به چه داده و چه
 *      دارایی‌ای نیاز دارد. بدون این پاس، یا باید همه‌چیز را همیشه خواند (که
 *      بودجهٔ عملکرد را می‌شکند) یا در میانهٔ رندر کوئری زد (که N+1 می‌سازد).
 *   ۳. **رندر** (`renderTree`) — از درخت تجزیه‌شده به HTML، با اعتبارسنجی پراپ
 *      در همان لحظه.
 */

import { validateProps, type ComponentRegistry, type Finding } from './registry.js';
import { plainImage, type ImagePicture } from './imagepipeline.js';
import { RENDERERS, UNRENDERABLE, type MediaView, type OutlineEntry, type RenderHelpers, type TreeData, type TreeNode } from './renderers.js';

export const TREE_LIMITS = {
  /** سقف گره‌ها: درختی بزرگ‌تر از این، عملاً یک حملهٔ منابع است. */
  maxNodes: 400,
  maxDepth: 12,
  /** سقف عضویت هر اسلات. */
  maxSlotItems: 60,
} as const;

export type TreeNeed = 'businesses' | 'contents' | 'business' | 'forms' | 'records';

export interface TreeScan {
  readonly nodes: readonly TreeNode[];
  readonly findings: readonly Finding[];
  readonly needs: ReadonlySet<TreeNeed>;
  readonly assetIds: readonly string[];
  readonly outline: readonly OutlineEntry[];
  readonly headingIds: ReadonlyMap<string, string>;
  /** وزن تخمینی صفحه بر پایهٔ `performance.weight_kb` هر کامپوننت (کیلوبایت). */
  readonly weightKb: number;
  /** کامپوننت‌هایی که این build رندرشان نمی‌کند (با دلیل). */
  readonly unrenderable: ReadonlyMap<string, string>;
  readonly nodeCount: number;
  readonly truncated: boolean;
}

const COMPONENT_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const NODE_ID = /^[A-Za-z0-9_-]{1,60}$/;
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

interface ParseState {
  count: number;
  truncated: boolean;
  readonly findings: Finding[];
  readonly needs: Set<TreeNeed>;
  readonly assetIds: Set<string>;
  readonly unrenderable: Map<string, string>;
  readonly outline: OutlineEntry[];
  readonly headingIds: Map<string, string>;
  weightKb: number;
  headingCounter: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** پیش‌نیازهای دادهٔ هر کامپوننت — همان‌جا که کامپوننت استفاده می‌شود. */
function collectNeeds(key: string, state: ParseState): void {
  if(key.startsWith('form.'))state.needs.add('forms');
  if(key==='data.crud_list')state.needs.add('records');
  if (key === 'data.business_list') state.needs.add('businesses');
  if (key === 'data.content_list') state.needs.add('contents');
  if (key === 'content.contact_block' || key === 'content.map') state.needs.add('business');
}

function collectAsset(value: unknown, state: ParseState): void {
  if (typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)) state.assetIds.add(value.toLowerCase());
}

/**
 * ریشهٔ درخت: `{version, root: [...]}`.
 *
 * نسخهٔ ناشناخته رد می‌شود. دلیلش آینده‌نگری است: اگر روزی ساختار درخت عوض
 * شود، باید **صریح** رد شود تا اینکه با ساختار قدیمی تفسیر و بی‌سروصدا خراب شود.
 */
export function treeRoot(input: unknown): { version: number; root: readonly unknown[] } | null {
  const record = asRecord(input);
  const version = typeof record['version'] === 'number' ? record['version'] : null;
  const root = record['root'];
  if (version !== 1 || !Array.isArray(root)) return null;
  return { version, root };
}

function parseNode(
  value: unknown,
  registry: ComponentRegistry,
  state: ParseState,
  depth: number,
  parentPath: string,
  index: number,
): TreeNode | null {
  if (state.count >= TREE_LIMITS.maxNodes) {
    state.truncated = true;
    return null;
  }

  const record = asRecord(value);
  const component = typeof record['component'] === 'string' ? record['component'] : null;
  const path = `${parentPath}>${index}`;

  if (component === null || !COMPONENT_KEY.test(component)) {
    state.findings.push({
      rule: 'structure.component_invalid',
      severity: 'blocker',
      message: 'گره بدون کلید کامپوننت معتبر، حذف شد.',
      path,
    });
    return null;
  }

  const spec = registry.get(component);
  if (!spec) {
    state.findings.push({
      rule: 'registry.component_unknown',
      severity: 'blocker',
      message: `کامپوننت «${component}» در Registry نیست و رندر نشد.`,
      path,
    });
    return null;
  }

  if (spec.status !== 'active') {
    state.findings.push({
      rule: 'registry.component_inactive',
      severity: 'warning',
      message: `کامپوننت «${component}» بازنشسته است و رندر نشد.`,
      path,
    });
    return null;
  }

  const notRenderable = UNRENDERABLE[component];
  if (notRenderable !== undefined) {
    state.unrenderable.set(component, notRenderable);
    state.findings.push({
      rule: 'component.not_renderable',
      severity: 'warning',
      message: `کامپوننت «${component}» در این build رندر نمی‌شود: ${notRenderable}.`,
      path,
    });
    return null;
  }

  if (!RENDERERS[component]) {
    state.unrenderable.set(component, 'رندرکنندهٔ این کامپوننت در build حاضر نیست');
    state.findings.push({
      rule: 'component.renderer_missing',
      severity: 'warning',
      message: `کامپوننت «${component}» در Registry هست ولی رندرکننده ندارد.`,
      path,
    });
    return null;
  }

  state.count += 1;
  state.weightKb += spec.performance.weightKb;

  const rawId = typeof record['id'] === 'string' && NODE_ID.test(record['id']) ? record['id'] : `n${state.count}`;
  const props = asRecord(record['props']);
  collectNeeds(component, state);
  for (const [key, propValue] of Object.entries(props)) {
    if (key === 'assetId' || key === 'posterAssetId') collectAsset(propValue, state);
    if (Array.isArray(propValue)) {
      for (const entry of propValue) collectAsset(asRecord(entry)['assetId'], state);
    }
  }

  /*
   * عنوان‌ها همین‌جا شناسه می‌گیرند (پیش‌رو). `navigation.toc` ممکن است پیش از
   * عنوان‌ها رندر شود؛ اگر شناسه در لحظهٔ رندر ساخته می‌شد، پیوندهای فهرست به
   * لنگرهای نادرست اشاره می‌کردند.
   */
  if (component === 'content.heading' || component === 'layout.section' || hasOwnHeading(component)) {
    const title = component === 'content.heading' ? props['text'] : props['title'];
    if (component === 'content.heading' || (typeof title === 'string' && title !== '')) {
      state.headingCounter += 1;
      const id = `h-${state.headingCounter}`;
      state.headingIds.set(rawId, id);
      if (component === 'content.heading' || component === 'layout.section') {
        state.outline.push({
          level: component === 'content.heading' ? headingLevel(props['level']) : 2,
          text: typeof title === 'string' ? title : '',
          id,
        });
      }
    }
  }

  const slots: Record<string, TreeNode[]> = {};
  if (depth < TREE_LIMITS.maxDepth) {
    const rawSlots = asRecord(record['slots']);
    for (const [slotName, slotValue] of Object.entries(rawSlots)) {
      if (!Array.isArray(slotValue)) continue;
      const children: TreeNode[] = [];
      const slice = slotValue.slice(0, TREE_LIMITS.maxSlotItems);
      for (let slotIndex = 0; slotIndex < slice.length; slotIndex += 1) {
        const child = parseNode(slice[slotIndex], registry, state, depth + 1, `${path}.${slotName}`, slotIndex);
        if (child) children.push(child);
      }
      if (children.length > 0) slots[slotName] = children;
    }
  } else if (Object.keys(asRecord(record['slots'])).length > 0) {
    state.findings.push({
      rule: 'structure.depth_exceeded',
      severity: 'error',
      message: `عمق درخت از ${TREE_LIMITS.maxDepth} گذشت؛ فرزندان این گره حذف شدند.`,
      path,
    });
  }

  return { id: rawId, component, props, slots };
}

/** کامپوننت‌هایی که خودشان عنوان می‌سازند (برای شناسهٔ لنگر). */
function hasOwnHeading(component: string): boolean {
  return component === 'content.contact_block' || component === 'data.business_list' || component === 'data.content_list' || component === 'navigation.toc';
}

function headingLevel(value: unknown): number {
  if (typeof value === 'string' && /^h[1-4]$/.test(value)) return Number(value.slice(1));
  return 2;
}

export interface ScanOptions {
  readonly registry: ComponentRegistry;
  /** متن‌های زمینه، برای جانشینی نگه‌دارنده‌ها در فهرست عنوان‌ها. */
  readonly strings?: Readonly<Record<string, string>>;
}

export function scanTree(input: unknown, options: ScanOptions): TreeScan {
  const state: ParseState = {
    count: 0,
    truncated: false,
    findings: [],
    needs: new Set(),
    assetIds: new Set(),
    unrenderable: new Map(),
    outline: [],
    headingIds: new Map(),
    weightKb: 0,
    headingCounter: 0,
  };

  const tree = treeRoot(input);
  if (!tree) {
    state.findings.push({
      rule: 'structure.tree_invalid',
      severity: 'blocker',
      message: 'درخت صفحه باید `{version, root: []}` باشد.',
      path: 'root',
    });
    return emptyScan(state);
  }

  const nodes: TreeNode[] = [];
  for (let index = 0; index < tree.root.length; index += 1) {
    const node = parseNode(tree.root[index], options.registry, state, 1, 'root', index);
    if (node) nodes.push(node);
  }

  if (state.truncated) {
    state.findings.push({
      rule: 'performance.tree_truncated',
      severity: 'warning',
      message: `درخت صفحه از ${TREE_LIMITS.maxNodes} گره گذشت و بریده شد.`,
      path: 'root',
    });
  }

  const strings = options.strings ?? {};
  const outline = state.outline.map((entry) => ({ ...entry, text: resolvePlaceholders(entry.text, strings, () => {}) }));

  return {
    nodes,
    findings: state.findings,
    needs: state.needs,
    assetIds: [...state.assetIds],
    outline,
    headingIds: state.headingIds,
    weightKb: state.weightKb,
    unrenderable: state.unrenderable,
    nodeCount: state.count,
    truncated: state.truncated,
  };
}

function emptyScan(state: ParseState): TreeScan {
  return {
    nodes: [],
    findings: state.findings,
    needs: new Set(),
    assetIds: [],
    outline: [],
    headingIds: new Map(),
    weightKb: 0,
    unrenderable: new Map(),
    nodeCount: 0,
    truncated: false,
  };
}

/**
 * جانشینی نگه‌دارنده‌های `{key}`.
 *
 * نگه‌دارندهٔ ناشناخته **خالی** می‌شود و یافته ثبت می‌کند. چاپ خام `{tagline}`
 * روی یک صفحهٔ عمومی، هم زشت است و هم نشانهٔ خرابی داده — ولی مهم‌تر: اگر
 * نگه‌دارنده‌ها همچنان قابل‌تزریق بمانند، مرز «داده در برابر کد» سست می‌شود.
 */
export function resolvePlaceholders(
  input: string,
  strings: Readonly<Record<string, string>>,
  report: (finding: Finding) => void,
): string {
  return input.replace(PLACEHOLDER, (_whole, key: string) => {
    const value = strings[key];
    if (value === undefined) {
      report({
        rule: 'content.unknown_placeholder',
        severity: 'warning',
        message: `نگه‌دارندهٔ «${key}» مقدار ندارد و خالی شد.`,
      });
      return '';
    }
    return value;
  });
}

export interface RenderOptions {
  readonly scan: TreeScan;
  /**
   * Registry کامپوننت‌ها — صریح پاس داده می‌شود، نه از حالت پنهان ماژول.
   * اگر Registry را حالت سراسری کنیم، دو استقرار با دو نسخه از Registry
   * (مثلاً نگارش و پیش‌نمایش) روی هم می‌افتند.
   */
  readonly registry: ComponentRegistry;
  readonly strings: Readonly<Record<string, string>>;
  readonly data: TreeData;
  readonly pageUrl: string;
  readonly locale: string;
  readonly media: ((assetId: string) => MediaView | null) | null;
  /** خط لولهٔ تصویر؛ `null` ⇒ `<img>` ساده. */
  readonly images?: ImagePicture | null;
}

export interface TreeRender {
  readonly html: string;
  readonly findings: readonly Finding[];
  readonly hasH1: boolean;
  readonly weightKb: number;
  readonly renderedNodes: number;
  readonly skipped: readonly string[];
}

/** رندر درخت تجزیه‌شده. خروجی، HTML ساختهٔ خودمان است — نه دادهٔ خام. */
export function renderTree(options: RenderOptions): TreeRender {
  const findings: Finding[] = [...options.scan.findings];
  const report = (finding: Finding): void => {
    findings.push(finding);
  };

  const strings = options.strings;
  const text = (value: unknown): string => {
    const base = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
    return resolvePlaceholders(base, strings, report);
  };

  const renderNode = (node: TreeNode): string => {
    const renderer = RENDERERS[node.component];
    if (!renderer) return '';
    const spec = options.registry.get(node.component);
    if (!spec) return '';

    const validated = validateProps(spec, node.props, node.id);
    for (const finding of validated.findings) findings.push(finding);

    /*
     * پراپ‌های معتبر، جای پراپ‌های خام می‌نشینند — رندرکننده هرگز پراپ خام
     * نمی‌بیند. این «پاک‌سازی در مرز» است، نه «اطمینان به ورودی».
     */
    const clean: TreeNode = { ...node, props: validated.props };

    try {
      return renderer(clean, helpers);
    } catch (error) {
      findings.push({
        rule: 'render.component_failed',
        severity: 'error',
        message: `رندر کامپوننت «${node.component}» شکست خورد: ${error instanceof Error ? error.message : String(error)}`,
        path: node.id,
      });
      return '';
    }
  };

  let h1Claimed = false;

  const helpers: RenderHelpers = {
    strings,
    data: options.data,
    pageUrl: options.pageUrl,
    locale: options.locale,
    text,
    children: (node, slot = 'default') => (node.slots[slot] ?? []).map(renderNode).join('\n'),
    slotNodes: (node, slot = 'default') => node.slots[slot] ?? [],
    media: (assetId) => {
      if (!options.media) {
        report({ rule: 'media.storage_unwired', severity: 'warning', message: 'خوانندهٔ رسانه در این استقرار فعال نیست؛ دارایی حذف شد.' });
        return null;
      }
      return options.media(assetId);
    },
    image: (media, imageOptions) => (options.images ? options.images.picture(media, imageOptions) : plainImage(media, imageOptions)),
    outline: options.scan.outline,
    claimH1: () => {
      if (h1Claimed) return false;
      h1Claimed = true;
      return true;
    },
    headingId: (nodeId) => options.scan.headingIds.get(nodeId) ?? 'sec',
    report,
  };

  const html = options.scan.nodes.map(renderNode).filter((part) => part !== '').join('\n');

  return {
    html,
    findings,
    hasH1: h1Claimed,
    weightKb: options.scan.weightKb,
    renderedNodes: options.scan.nodeCount,
    skipped: [...options.scan.unrenderable.keys()],
  };
}
/** کمکی صفحه‌ها: آیا درخت اصلاً چیزی برای رندر دارد؟ */
export function treeIsUsable(scan: TreeScan): boolean {
  return scan.nodes.length > 0;
}
