/**
 * رندرکنندهٔ درخت JSON (گام ۲۳؛ §32–۴۴، §161–۱۶۹، Addendum §۳۰–۳۳).
 *
 * هر کامپوننت Registry اینجا **یک** رندرکننده دارد و هر رندرکننده فقط از سه
 * سازندهٔ امن `html.ts` استفاده می‌کند. هیچ‌جا رشتهٔ HTML از داده ساخته نمی‌شود؛
 * همه‌چیز از `tag`/`attrs`/`escapeText` می‌گذرد — به همین دلیل درخت صفحه
 * نمی‌تواند از تگ بیرون بزند، حتی اگر Registry را کسی دستی خراب کند.
 *
 * سه قاعدهٔ ساختاری که در رندر اجبار می‌شوند (§45–۴۷، Addendum §۳۱):
 *
 *   ۱. **ساختار سمنتیک.** `section`/`nav`/`article`/`figure`/`table`/`details` —
 *      نه `div` تودرتو. صفحه‌خوان و خزنده هر دو از همین ساختار می‌خوانند.
 *   ۲. **یک `h1` در هر صفحه.** اولین عنوان سطح ۱ می‌ماند، بقیه به سطح ۲ تنزل
 *      می‌کنند (با یافتهٔ ثبت‌شده). چند `h1` یعنی سلسله‌مراتب نامعلوم.
 *   ۳. **تصویر بدون بُعد چاپ نمی‌شود.** اگر دارایی عرض/ارتفاع نداشته باشد،
 *      تصویر رندر نمی‌شود؛ نه با جعبهٔ خالی که CLS می‌سازد.
 */

import { escapeText, tag, voidTag } from './html.js';
import {uuidv7} from '@petavu/shared';
import type {FormSchemaView} from './nocode.js';
import { formatNumber, timeTag } from './components.js';
import type { Finding } from './registry.js';
import { sanitizeHref } from './registry.js';

export interface TreeNode {
  readonly id: string;
  readonly component: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly slots: Readonly<Record<string, readonly TreeNode[]>>;
}

export interface MediaView {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string | null;
  readonly kind: 'image' | 'video' | 'other';
  readonly posterUrl?: string | null;
  /** شناسهٔ دارایی؛ نشانی نسخه‌ها (`?w=…&f=…`) از آن ساخته می‌شود. */
  readonly assetId?: string;
  /** نوع MIME اصلی؛ فقط تصویر رستری شایستهٔ AVIF/WebP است (نه GIF متحرک، نه SVG). */
  readonly mime?: string;
  /** پیشوند درهم محتوا؛ بدون آن، `immutable` امن نیست و نسخه‌ای ساخته نمی‌شود. */
  readonly version?: string | null;
}

/** گزینه‌های چاپ یک تصویر؛ `priority` فقط برای تصویر LCP. */
export interface ImageOptions {
  readonly alt: string;
  readonly className: string;
  readonly loading: 'lazy' | 'eager';
  readonly priority?: boolean;
  readonly sizes?: string;
}

export interface ContactView {
  readonly kind: string;
  readonly display: string;
  readonly label: string;
  readonly href: string | null;
}

export interface BusinessView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly typeName: string | null;
  readonly cityName: string | null;
  readonly url: string;
  readonly address: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly hours: readonly string[];
  readonly contacts: readonly ContactView[];
}

export interface BusinessCardView {
  readonly name: string;
  readonly url: string;
  readonly summary: string | null;
  readonly cityName: string | null;
}

export interface ContentCardView {
  readonly title: string;
  readonly url: string;
  readonly summary: string | null;
  readonly publishedAt: string | null;
}

export interface TreeData {
  readonly forms?:ReadonlyMap<string,FormSchemaView>;
  readonly records?:ReadonlyMap<string,readonly {title:string;url:string}[]>;
  readonly businesses: readonly BusinessCardView[];
  readonly contents: readonly ContentCardView[];
  readonly business: BusinessView | null;
}

export interface OutlineEntry {
  readonly level: number;
  readonly text: string;
  readonly id: string;
}

export interface RenderHelpers {
  readonly strings: Readonly<Record<string, string>>;
  readonly data: TreeData;
  /** نشانی مطلق صفحه — برای پیوندهای اشتراک‌گذاری. */
  readonly pageUrl: string;
  readonly locale: string;
  /** متن پراپ: جانشینی نگه‌دارنده‌ها + escape. */
  readonly text: (value: unknown) => string;
  /** فرزندان یک اسلات؛ نبودِ اسلات ⇒ رشتهٔ خالی. */
  readonly children: (node: TreeNode, slot?: string) => string;
  readonly slotNodes: (node: TreeNode, slot?: string) => readonly TreeNode[];
  /** دارایی رسانه؛ اگر قابل‌استفاده نباشد `null`. */
  readonly media: (assetId: string) => MediaView | null;
  /**
   * چاپ یک تصویر: `<picture>` با AVIF/WebP و `srcset` اگر خط لولهٔ تصویر آماده باشد، وگرنه
   * `<img>` ساده. بُعد همیشه چاپ می‌شود (CLS)، و `priority` فقط برای LCP.
   */
  readonly image: (media: MediaView, options: ImageOptions) => string;
  /** فهرست عنوان‌های صفحه، از پیش‌اسکن‌شده (برای `navigation.toc`). */
  readonly outline: readonly OutlineEntry[];
  /** آیا صفحه تا این لحظه `h1` گرفته است؟ */
  readonly claimH1: () => boolean;
  /**
   * شناسهٔ لنگر عنوان برای یک گره.
   *
   * شناسه‌ها در یک پاس پیش‌رو (در `tree.ts`) تعیین می‌شوند تا `navigation.toc`
   * — که ممکن است **پیش از** عنوان‌ها رندر شود — همان شناسه‌ها را ببیند. اگر
   * شناسه در لحظهٔ رندر ساخته می‌شد، فهرست مطالب به لنگرهای دیگری اشاره می‌کرد.
   */
  readonly headingId: (nodeId: string) => string;
  readonly report: (finding: Finding) => void;
}

export type ComponentRenderer = (node: TreeNode, helpers: RenderHelpers) => string;

const renderSchemaForm:ComponentRenderer=(node,h)=>{
 const purpose=node.component==='form.contact_form'?'contact':node.component==='form.lead_form'?'lead':node.component==='form.newsletter'?'newsletter':null;
 const requested=typeof node.props['formId']==='string'?node.props['formId']:purpose;const schema=requested?h.data.forms?.get(requested):undefined;
 if(!schema){h.report({rule:'nocode.form_missing',severity:'blocker',message:'تعریف منتشرشدنیِ فرم در این محدوده حاضر نیست.',path:node.id});return '';}
 const body=schema.fields.map(f=>{const s=f.spec;const id=node.id+'-'+f.key;const label=tag('label',{for:id},escapeText(String(s['label_fa'])));const common={id,name:f.key,required:s['required']===true?true:null,class:'input',maxlength:Number(s['max_length']??4000)};let control='';
 if(s['type']==='longtext')control=tag('textarea',{...common,rows:5},'');else if(s['type']==='enum')control=tag('select',common,(s['options'] as Array<{key:string;label_fa:string}>).map(o=>tag('option',{value:o.key},escapeText(o.label_fa))).join(''));else if(s['type']==='boolean')control=tag('select',common,tag('option',{value:'false'},'خیر')+tag('option',{value:'true'},'بله'));else control=voidTag('input',{...common,type:({number:'number',email:'email',date:'date',url:'url',phone:'tel'} as Record<string,string>)[String(s['type'])]??'text',...(s['type']==='number'?{step:'any',min:s['min'] as number|undefined,max:s['max'] as number|undefined}:{})});return tag('div',{class:'field'},label+control);
 }).join('');
 const receiver=schema.business_id??'platform';return tag('section',{class:'ds-form'},tag('h2',{},escapeText(String(node.props['title']??schema.form.spec['title_fa'])))+tag('form',{method:'post',action:`/forms/${receiver}/${schema.form.id}`,class:'stack'},[
 voidTag('input',{type:'hidden',name:'_schema',value:schema.schema_hash}),voidTag('input',{type:'hidden',name:'_nonce',value:uuidv7()}),tag('div',{class:'visually-hidden','aria-hidden':'true'},tag('label',{for:node.id+'-website'},'این فیلد را خالی بگذارید')+voidTag('input',{id:node.id+'-website',name:'_website',type:'text',tabindex:-1,autocomplete:'off'})),body,tag('label',{class:'cluster'},voidTag('input',{type:'checkbox',name:'_consent',value:'true',required:true})+escapeText(String(node.props['consentText']??node.props['privacyNote']??'با ثبت و نگهداری این اطلاعات برای رسیدگی به درخواست موافقم.'))),tag('button',{type:'submit',class:'button button--primary'},escapeText(String(node.props['submitLabel']??schema.form.spec['submit_label']??'ثبت درخواست')))
 ].join('')));
};
const renderCrudList:ComponentRenderer=(node,h)=>{const id=typeof node.props['definitionId']==='string'?node.props['definitionId']:null;const records=id?h.data.records?.get(id):null;if(!records){h.report({rule:'nocode.model_missing',severity:'blocker',message:'مدل CRUD در محدوده نیست.',path:node.id});return '';}return records.length?tag('ul',{class:'ds-list'},records.map(v=>tag('li',{},tag('a',{href:v.url},escapeText(v.title)))).join('')):tag('p',{class:'ds-text'},'هنوز مورد عمومیِ منتشرشده‌ای در این مدل وجود ندارد.');};

/* ------------------------------------------------------------------ کمک‌ابزارها */

function str(node: TreeNode, key: string): string | null {
  const value = node.props[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(node: TreeNode, key: string): number | null {
  const value = node.props[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(node: TreeNode, key: string, fallback = false): boolean {
  const value = node.props[key];
  return typeof value === 'boolean' ? value : fallback;
}

function list(node: TreeNode, key: string): readonly Record<string, unknown>[] {
  const value = node.props[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry));
}

function strings(node: TreeNode, key: string): readonly string[] {
  const value = node.props[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function cta(node: TreeNode, key: string): { label: string; href: string | null } | null {
  const value = node.props[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const label = typeof record['label'] === 'string' ? record['label'] : null;
  if (label === null) return null;
  const raw = record['href'];
  return { label, href: typeof raw === 'string' ? raw : null };
}

/** پیوند؛ نشانی بیرونی با `rel` محافظ و نشانهٔ بیرونی چاپ می‌شود. */
function link(href: string | null, label: string, className: string): string {
  if (href === null) return tag('span', { class: className }, escapeText(label));
  const external = /^https?:\/\//i.test(href);
  return tag(
    'a',
    {
      class: className,
      href,
      rel: external ? 'noopener noreferrer nofollow' : null,
      target: external ? '_blank' : null,
    },
    escapeText(label),
  );
}

function classes(...values: Array<string | null | false | undefined>): string {
  return values.filter((value): value is string => typeof value === 'string' && value !== '').join(' ');
}

function aspectClass(ratio: string | null): string {
  return ratio === null ? 'ds-ratio--3-2' : `ds-ratio--${ratio.replace(':', '-')}`;
}

/* ------------------------------------------------------------------ چیدمان */

const sectionRenderer: ComponentRenderer = (node, h) => {
  const title = str(node, 'title');
  const anchor = str(node, 'anchor');
  const headingId = title ? h.headingId(node.id) : null;
  const body = h.children(node);

  return tag(
    'section',
    {
      class: classes('ds-block', `ds-block--pad-${str(node, 'padding') ?? 'md'}`, `ds-block--bg-${str(node, 'background') ?? 'none'}`),
      id: anchor,
      'aria-labelledby': headingId,
    },
    [
      title ? tag('h2', { class: 'ds-heading', id: headingId }, escapeText(title)) : '',
      tag('div', { class: 'ds-block__body' }, body),
    ],
  );
};

const gridRenderer: ComponentRenderer = (node, h) =>
  tag(
    'div',
    { class: classes('ds-grid', `ds-grid--${str(node, 'columns') ?? '3'}`, `ds-grid--gap-${str(node, 'gap') ?? 'md'}`) },
    h.children(node),
  );

const columnsRenderer: ComponentRenderer = (node, h) =>
  tag(
    'div',
    { class: classes('ds-columns', `ds-columns--${str(node, 'ratio') ?? '50-50'}`, bool(node, 'reverse') ? 'ds-columns--reverse' : null) },
    [
      tag('div', { class: 'ds-columns__cell' }, h.children(node, 'start')),
      tag('div', { class: 'ds-columns__cell' }, h.children(node, 'end')),
    ],
  );

/* ------------------------------------------------------------------ محتوا */

/**
 * عنوان.
 *
 * قاعدهٔ «یک `h1`»: نخستین عنوان سطح ۱ ادعا می‌شود؛ هر `h1` بعدی به `h2`
 * تنزل می‌کند و یافته ثبت می‌شود. تنزل، ترجیحِ سئو است؛ حذف، تباهی محتوا.
 */
function headingRenderer(node: TreeNode, h: RenderHelpers): string {
  const requested = str(node, 'level') ?? 'h2';
  let level = requested;

  if (level === 'h1' && !h.claimH1()) {
    level = 'h2';
    h.report({
      rule: 'a11y.multiple_h1_downgraded',
      severity: 'warning',
      message: 'عنوان سطح ۱ دوم در صفحه به سطح ۲ تنزل کرد.',
      path: node.id,
    });
  }

  const text = h.text(node.props['text']);
  return tag(
    level,
    {
      class: classes('ds-heading', str(node, 'align') === 'center' ? 'ds-heading--center' : null),
      id: h.headingId(node.id),
    },
    escapeText(text),
  );
}

const paragraphRenderer: ComponentRenderer = (node, h) =>
  tag('p', { class: `ds-text ds-text--${str(node, 'size') ?? 'md'}` }, escapeText(h.text(node.props['text'])));

const buttonRenderer: ComponentRenderer = (node, h) =>
  link(
    str(node, 'href'),
    h.text(node.props['label']),
    classes('ds-cta', `ds-cta--${str(node, 'variant') ?? 'primary'}`, `ds-cta--${str(node, 'size') ?? 'md'}`),
  );

const badgeRenderer: ComponentRenderer = (node, h) =>
  tag('span', { class: classes('badge', `badge--${str(node, 'tone') ?? 'neutral'}`) }, escapeText(h.text(node.props['text'])));

const heroRenderer: ComponentRenderer = (node, h) => {
  const title = h.text(node.props['title']);
  const subtitle = str(node, 'subtitle');
  const assetId = str(node, 'assetId');
  const media = assetId ? h.media(assetId) : null;

  if (assetId && !media) {
    h.report({ rule: 'media.unresolved', severity: 'warning', message: 'تصویر سرصفحه در دسترس نبود و حذف شد.', path: node.id });
  }

  // سرصفحه، `h1` می‌سازد؛ پس باید ادعای عنوان اصلی را ثبت کند تا عنوان‌های
  // بعدی سطح ۱، دوباره `h1` نسازند.
  h.claimH1();

  const actions = [cta(node, 'primaryCta'), cta(node, 'secondaryCta')]
    .filter((entry): entry is { label: string; href: string | null } => entry !== null)
    .map((entry, index) => link(entry.href, entry.label, classes('ds-cta', index === 0 ? 'ds-cta--primary' : 'ds-cta--secondary', 'ds-cta--md')))
    .join('');

  return tag(
    'section',
    { class: classes('ds-hero', `ds-hero--${str(node, 'layout') ?? 'split'}`) },
    [
      tag('div', { class: 'ds-hero__body' }, [
        // `h1` سرصفحه، ادعای عنوان اصلی صفحه است؛ بقیهٔ عنوان‌ها پایین‌تر می‌نشینند.
        tag('h1', { class: 'ds-hero__title' }, escapeText(title)),
        subtitle ? tag('p', { class: 'ds-hero__subtitle' }, escapeText(h.text(subtitle))) : '',
        actions ? tag('div', { class: 'ds-hero__actions cluster' }, actions) : '',
      ].join('')),
      media
        ? tag('div', { class: 'ds-hero__media' }, h.image(media, {
          alt: media.alt ?? title,
          className: classes('ds-figure__img', 'ds-ratio--16-9'),
          loading: 'eager',
          priority: true,
          sizes: '(min-width: 1024px) 50vw, 100vw',
        }))
        : '',
    ].join(''),
  );
}

const cardRenderer: ComponentRenderer = (node, h) => {
  const title = h.text(node.props['title']);
  const description = str(node, 'description');
  const href = str(node, 'href');
  const assetId = str(node, 'assetId');
  const media = assetId ? h.media(assetId) : null;
  if (assetId && !media) {
    h.report({ rule: 'media.unresolved', severity: 'warning', message: 'تصویر کارت در دسترس نبود و حذف شد.', path: node.id });
  }

  const tone = str(node, 'tone') ?? 'surface';
  const body = [
    media
      ? h.image(media, {
          alt: media.alt ?? title,
          className: classes('ds-figure__img', 'ds-ratio--3-2'),
          loading: 'lazy',
          sizes: '(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw',
        })
      : '',
    tag('h3', { class: 'card__title' }, escapeText(title)),
    description ? tag('p', { class: 'ds-text' }, escapeText(h.text(description))) : '',
    h.children(node, 'footer'),
    h.children(node),
  ].join('');

  if (href !== null) {
    return tag('article', { class: classes('card', `ds-card--${tone}`) }, tag('a', { class: 'card__link', href }, body));
  }
  return tag('article', { class: classes('card', `ds-card--${tone}`) }, body);
};

const listRenderer: ComponentRenderer = (node, h) => {
  const items = strings(node, 'items');
  const ordered = bool(node, 'ordered');
  const children = items.map((item) => tag('li', {}, escapeText(h.text(item)))).join('');
  return tag(ordered ? 'ol' : 'ul', { class: 'ds-list', role: 'list' }, children);
};

const featureGridRenderer: ComponentRenderer = (node, h) => {
  const items = list(node, 'items');
  if (items.length === 0) {
    h.report({ rule: 'content.empty_section', severity: 'warning', message: 'شبکهٔ ویژگی‌ها بدون عضو، حذف شد.', path: node.id });
    return '';
  }

  const cells = items.map((item) =>
    tag('li', { class: 'ds-feature' }, [
      typeof item['title'] === 'string' ? tag('h3', { class: 'ds-feature__title' }, escapeText(h.text(item['title']))) : '',
      typeof item['text'] === 'string' ? tag('p', { class: 'ds-feature__text' }, escapeText(h.text(item['text']))) : '',
    ].join('')),
  );

  return tag(
    'ul',
    { class: classes('ds-grid', `ds-grid--${str(node, 'columns') ?? '3'}`, 'ds-grid--gap-md'), role: 'list' },
    cells.join(''),
  );
};

const statRenderer: ComponentRenderer = (node, h) => {
  const value = str(node, 'value') ?? '';
  const suffix = str(node, 'suffix');
  const numeric = Number(value.replace(/[٬,]/g, ''));
  const display = Number.isFinite(numeric) ? `${formatNumber(numeric)}${suffix ?? ''}` : `${value}${suffix ?? ''}`;
  return tag('div', { class: 'ds-stat' }, [
    tag('data', { class: 'ds-stat__value', value }, escapeText(display)),
    tag('span', { class: 'ds-stat__label' }, escapeText(h.text(node.props['label']))),
  ].join(''));
};

const pricingRenderer: ComponentRenderer = (node, h) => {
  const plans = list(node, 'plans');
  if (plans.length === 0) {
    h.report({ rule: 'content.empty_section', severity: 'warning', message: 'جدول قیمت بدون طرح، حذف شد.', path: node.id });
    return '';
  }

  const cards = plans.map((plan) => {
    const features = Array.isArray(plan['features'])
      ? plan['features'].filter((entry): entry is string => typeof entry === 'string')
      : [];
    const planCta = typeof plan['cta'] === 'object' && plan['cta'] !== null
      ? (plan['cta'] as Record<string, unknown>)
      : null;
    const href = planCta && typeof planCta['href'] === 'string' ? sanitizeHref(planCta['href']) : null;
    const label = planCta && typeof planCta['label'] === 'string' ? planCta['label'] : null;

    return tag(
      'article',
      { class: classes('card', 'ds-plan', plan['highlighted'] === true ? 'ds-plan--highlighted' : null) },
      [
        typeof plan['name'] === 'string' ? tag('h3', { class: 'card__title' }, escapeText(h.text(plan['name']))) : '',
        typeof plan['price'] === 'string'
          ? tag('p', { class: 'ds-plan__price' }, tag('data', { value: plan['price'] }, escapeText(h.text(plan['price']))))
          : '',
        typeof plan['period'] === 'string' ? tag('p', { class: 'card__meta' }, escapeText(h.text(plan['period']))) : '',
        features.length > 0
          ? tag('ul', { class: 'ds-list', role: 'list' }, features.map((feature) => tag('li', {}, escapeText(h.text(feature)))).join(''))
          : '',
        label ? link(href, label, 'ds-cta ds-cta--secondary ds-cta--md') : '',
      ].join(''),
    );
  });

  return tag('div', { class: 'ds-grid ds-grid--3 ds-grid--gap-md' }, cards.join(''));
};

const faqRenderer: ComponentRenderer = (node, h) => {
  const items = list(node, 'items');
  if (items.length === 0) {
    h.report({ rule: 'content.empty_section', severity: 'warning', message: 'پرسش‌های متداول بدون عضو، حذف شد.', path: node.id });
    return '';
  }

  const details = items.map((item) =>
    tag('details', { class: 'ds-faq__item' }, [
      tag('summary', { class: 'ds-faq__q' }, escapeText(h.text(item['question'] ?? ''))),
      tag('div', { class: 'ds-faq__a' }, tag('p', { class: 'ds-text' }, escapeText(h.text(item['answer'] ?? '')))),
    ].join('')),
  );

  // `<details>` یعنی تاشو **بدون JavaScript** — و همین، یکی از دلایل CSP سخت است.
  return tag('div', { class: 'ds-faq' }, details.join(''));
};

const quoteRenderer: ComponentRenderer = (node, h) => {
  const source = str(node, 'source');
  const role = str(node, 'role');
  const caption = [source, role].filter((part): part is string => part !== null).join(' — ');
  return tag('figure', { class: 'ds-quote' }, [
    tag('blockquote', { class: 'ds-quote__text' }, escapeText(h.text(node.props['text']))),
    caption ? tag('figcaption', { class: 'ds-quote__source' }, escapeText(caption)) : '',
  ].join(''));
};

const calloutRenderer: ComponentRenderer = (node, h) => {
  const tone = str(node, 'tone') ?? 'info';
  const title = str(node, 'title');
  return tag(
    'aside',
    { class: classes('ds-callout', `ds-callout--${tone}`), role: tone === 'danger' || tone === 'warning' ? 'note' : null },
    [
      title ? tag('p', { class: 'ds-callout__title' }, escapeText(h.text(title))) : '',
      tag('p', { class: 'ds-text' }, escapeText(h.text(node.props['text']))),
    ].join(''),
  );
};

const stepsRenderer: ComponentRenderer = (node, h) => {
  const items = list(node, 'items');
  if (items.length === 0) {
    h.report({ rule: 'content.empty_section', severity: 'warning', message: 'مراحل بدون عضو، حذف شد.', path: node.id });
    return '';
  }

  const ordered = bool(node, 'ordered', true);
  const cells = items.map((item) =>
    tag('li', { class: 'ds-step' }, [
      typeof item['title'] === 'string' ? tag('h3', { class: 'ds-step__title' }, escapeText(h.text(item['title']))) : '',
      typeof item['text'] === 'string' ? tag('p', { class: 'ds-step__text' }, escapeText(h.text(item['text']))) : '',
    ].join('')),
  );

  return tag(ordered ? 'ol' : 'ul', { class: 'ds-steps', role: 'list' }, cells.join(''));
};

const tableRenderer: ComponentRenderer = (node, h) => {
  const columns = strings(node, 'columns');
  const rows = Array.isArray(node.props['rows'])
    ? node.props['rows'].filter((row): row is readonly string[] => Array.isArray(row))
    : [];
  const caption = str(node, 'caption');

  if (columns.length === 0) {
    h.report({ rule: 'content.empty_section', severity: 'warning', message: 'جدول بدون ستون، حذف شد.', path: node.id });
    return '';
  }

  const head = tag('tr', {}, columns.map((column) => tag('th', { scope: 'col' }, escapeText(h.text(column)))).join(''));
  const body = rows
    .map((row) =>
      tag('tr', {}, columns.map((_, index) => tag('td', {}, escapeText(h.text(row[index] ?? '')))).join('')),
    )
    .join('');

  return tag('div', { class: 'ds-table-wrap', tabindex: '0', role: 'region', 'aria-label': caption ?? 'جدول' }, tag('table', { class: 'ds-table' }, [
    caption ? tag('caption', {}, escapeText(h.text(caption))) : '',
    tag('thead', {}, head),
    tag('tbody', {}, body),
  ].join('')));
};

const ctaBannerRenderer: ComponentRenderer = (node, h) => {
  const title = str(node, 'title');
  const text = str(node, 'text');
  const action = cta(node, 'cta');
  return tag('aside', { class: classes('ds-cta-banner', `ds-cta-banner--${str(node, 'tone') ?? 'brand'}`) }, [
    title ? tag('h2', { class: 'ds-cta-banner__title' }, escapeText(h.text(title))) : '',
    text ? tag('p', { class: 'ds-cta-banner__text' }, escapeText(h.text(text))) : '',
    action ? link(action.href, action.label, 'ds-cta ds-cta--secondary ds-cta--md') : '',
  ].join(''));
};

/**
 * بلوک تماس.
 *
 * داده از **پروفایل عمومی** می‌آید: راه‌های تماسی که خود کسب‌وکار عمومی کرده
 * (`is_public`) به‌همراه نشانی و ساعات کار. چیزی که نیست، ساخته نمی‌شود.
 */
const contactBlockRenderer: ComponentRenderer = (node, h) => {
  const business = h.data.business;
  if (!business) {
    h.report({ rule: 'data.context_missing', severity: 'warning', message: 'بلوک تماس بدون زمینهٔ کسب‌وکار حذف شد.', path: node.id });
    return '';
  }

  const rows: string[] = [];
  if (business.address) {
    rows.push(tag('li', {}, [tag('span', { class: 'ds-contact__label' }, escapeText('نشانی: ')), escapeText(business.address)].join('')));
  }
  for (const contact of business.contacts) {
    rows.push(
      tag('li', {}, [
        tag('span', { class: 'ds-contact__label' }, escapeText(`${contact.label}: `)),
        contact.href ? link(contact.href, contact.display, 'ds-contact__value') : escapeText(contact.display),
      ].join('')),
    );
  }
  if (bool(node, 'showHours', true) && business.hours.length > 0) {
    rows.push(tag('li', {}, [tag('span', { class: 'ds-contact__label' }, escapeText('ساعات کار: ')), escapeText(business.hours.join('، '))].join('')));
  }

  const mapLink = bool(node, 'showMap') && business.latitude !== null && business.longitude !== null
    ? link(mapUrl(business.latitude, business.longitude), 'مشاهدهٔ موقعیت روی نقشه', 'ds-cta ds-cta--link ds-cta--md')
    : '';

  if (rows.length === 0 && mapLink === '') {
    h.report({ rule: 'content.empty_section', severity: 'warning', message: 'بلوک تماس داده‌ای برای نمایش نداشت و حذف شد.', path: node.id });
    return '';
  }

  const title = str(node, 'title') ?? 'تماس با ما';
  const headingId = h.headingId(node.id);

  return tag('section', { class: 'ds-contact', 'aria-labelledby': headingId }, [
    tag('h2', { class: 'ds-heading', id: headingId }, escapeText(h.text(title))),
    rows.length > 0 ? tag('ul', { class: 'ds-contact__rows', role: 'list' }, rows.join('')) : '',
    mapLink,
  ].join(''));
};

function mapUrl(latitude: number, longitude: number): string {
  const lat = latitude.toFixed(6);
  const lon = longitude.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}

/**
 * نقشه.
 *
 * کد نقشهٔ بیرونی، **بارگذاری خودکار** ندارد (Registry: `on-interaction`)؛ پس
 * اینجا یک نشانی ایستا با مختصات و پیوند بیرونی می‌آید، نه `<iframe>`. اگر
 * روزی نقشهٔ تعاملی لازم شد، با رضایت کاربر و پس از تعامل بارگذاری می‌شود.
 */
const mapRenderer: ComponentRenderer = (node, h) => {
  const latitude = num(node, 'latitude');
  const longitude = num(node, 'longitude');
  if (latitude === null || longitude === null) {
    h.report({ rule: 'structure.required_prop_missing', severity: 'error', message: 'نقشه بدون مختصات رندر نمی‌شود.', path: node.id });
    return '';
  }

  const title = str(node, 'title') ?? 'موقعیت روی نقشه';
  return tag('section', { class: 'ds-map' }, [
    tag('h2', { class: 'ds-heading' }, escapeText(h.text(title))),
    tag('p', { class: 'ds-text ds-text--sm' }, escapeText(`${latitude.toFixed(5)}، ${longitude.toFixed(5)}`)),
    link(mapUrl(latitude, longitude), 'بازکردن در نقشهٔ آزاد', 'ds-cta ds-cta--link ds-cta--md'),
  ].join(''));
};

/* ------------------------------------------------------------------ رسانه */

const imageRenderer: ComponentRenderer = (node, h) => {
  const assetId = str(node, 'assetId');
  const media = assetId ? h.media(assetId) : null;
  if (!media) {
    h.report({ rule: 'media.unresolved', severity: 'warning', message: 'دارایی تصویر قابل‌استفاده نبود و حذف شد.', path: node.id });
    return '';
  }

  const alt = str(node, 'alt') ?? media.alt ?? '';
  const caption = str(node, 'caption');
  const priority = bool(node, 'priority') || str(node, 'loading') === 'eager';

  return tag('figure', { class: 'ds-figure' }, [
    h.image(media, {
      alt: h.text(alt),
      className: classes('ds-figure__img', aspectClass(str(node, 'ratio')), bool(node, 'rounded', true) ? 'ds-figure__img--rounded' : null),
      loading: priority ? 'eager' : 'lazy',
      priority,
      sizes: '(min-width: 1024px) 720px, 100vw',
    }),
    caption ? tag('figcaption', { class: 'ds-figure__caption' }, escapeText(h.text(caption))) : '',
  ].join(''));
};

const galleryRenderer: ComponentRenderer = (node, h) => {
  const items = list(node, 'items');
  const rendered: string[] = [];
  let index = 0;

  for (const item of items) {
    const assetId = typeof item['assetId'] === 'string' ? item['assetId'] : null;
    const media = assetId ? h.media(assetId) : null;
    if (!media) continue;

    const alt = typeof item['alt'] === 'string' ? item['alt'] : (media.alt ?? '');
    const caption = typeof item['caption'] === 'string' ? item['caption'] : null;
    rendered.push(
      tag('figure', { class: 'ds-figure' }, [
        h.image(media, {
          alt: h.text(alt),
          className: classes('ds-figure__img', 'ds-ratio--4-3', 'ds-figure__img--rounded'),
          // تصویر نخست eager است، بقیه تنبل (Registry: weight_kb 4 و یادداشت آن).
          loading: index === 0 ? 'eager' : 'lazy',
          sizes: '(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw',
        }),
        caption ? tag('figcaption', { class: 'ds-figure__caption' }, escapeText(h.text(caption))) : '',
      ].join('')),
    );
    index += 1;
  }

  if (rendered.length === 0) {
    h.report({ rule: 'media.unresolved', severity: 'warning', message: 'هیچ دارایی گالری قابل‌استفاده نبود؛ گالری حذف شد.', path: node.id });
    return '';
  }

  return tag('div', { class: classes('ds-gallery', `ds-gallery--${str(node, 'columns') ?? '3'}`) }, rendered.join(''));
};

const logoRenderer: ComponentRenderer = (node, h) => {
  const assetId = str(node, 'assetId');
  const media = assetId ? h.media(assetId) : null;
  if (!media) {
    h.report({ rule: 'media.unresolved', severity: 'warning', message: 'لوگو در دسترس نبود و حذف شد.', path: node.id });
    return '';
  }

  const image = h.image(media, {
    alt: h.text(str(node, 'alt') ?? ''),
    className: classes('ds-logo', `ds-logo--${str(node, 'size') ?? 'md'}`),
    loading: 'eager',
    priority: true,
    sizes: '(min-width: 768px) 160px, 120px',
  });

  const href = str(node, 'href');
  return href ? tag('div', { class: 'ds-logo__wrap' }, tag('a', { href, class: 'ds-logo__link' }, image)) : tag('div', { class: 'ds-logo__wrap' }, image);
};

const videoRenderer: ComponentRenderer = (node, h) => {
  const media = str(node, 'assetId') ? h.media(str(node, 'assetId') as string) : null;
  if (!media) {
    h.report({ rule: 'media.unresolved', severity: 'warning', message: 'ویدیو در دسترس نبود و حذف شد.', path: node.id });
    return '';
  }

  const muted = bool(node, 'muted', true);
  const autoplay = bool(node, 'autoplay');
  if (autoplay && !muted) {
    h.report({ rule: 'a11y.autoplay_with_sound_blocked', severity: 'warning', message: 'پخش خودکار با صدا مجاز نیست؛ پخش خودکار حذف شد.', path: node.id });
  }

  const poster = str(node, 'posterAssetId') ? h.media(str(node, 'posterAssetId') as string) : null;
  const caption = str(node, 'caption');

  const video = tag('video', {
    class: 'ds-video',
    controls: bool(node, 'controls', true) ? true : null,
    muted: muted ? true : null,
    loop: bool(node, 'loop') ? true : null,
    autoplay: autoplay && muted ? true : null,
    playsinline: true,
    poster: poster ? poster.url : null,
    // پیش‌بارگذاری نمی‌کنیم؛ فایل فقط با درخواست کاربر می‌آید (Registry).
    preload: 'none',
  }, voidTag('source', { src: media.url }));

  return tag('figure', { class: 'ds-figure' }, [video, caption ? tag('figcaption', { class: 'ds-figure__caption' }, escapeText(h.text(caption))) : ''].join(''));
};

/* ------------------------------------------------------------------ ناوبری */

const breadcrumbRenderer: ComponentRenderer = (node, h) => {
  const items = list(node, 'items');
  if (items.length === 0) return '';
  const rendering = items.map((item, index) => {
    const label = typeof item['label'] === 'string' ? item['label'] : '';
    const isLast = index === items.length - 1;
    const href = typeof item['href'] === 'string' ? sanitizeHref(item['href']) : null;
    const content = href !== null && !isLast ? link(href, h.text(label), 'site-nav__link') : escapeText(h.text(label));
    return tag('li', isLast ? { 'aria-current': 'page' } : {}, content);
  });

  return tag('nav', { class: 'breadcrumb', 'aria-label': 'مسیر صفحه' }, tag('ol', { role: 'list' }, rendering.join('')));
};

const tabsRenderer: ComponentRenderer = (node, h) => {
  const items = list(node, 'items');
  if (items.length === 0) return '';
  const links = items
    .filter((item) => typeof item['label'] === 'string' && typeof item['anchor'] === 'string')
    .map((item) => tag('a', { class: 'ds-tabs__item', href: `#${String(item['anchor']).replace(/[^\w\-.~:]/gu, '')}` }, escapeText(h.text(item['label']))));
  return tag('nav', { class: classes('ds-tabs', `ds-tabs--${str(node, 'style') ?? 'pill'}`), 'aria-label': 'بخش‌های صفحه' }, links.join(''));
};

const tocRenderer: ComponentRenderer = (node, h) => {
  const depth = Number(str(node, 'depth') ?? '2');
  const entries = h.outline.filter((entry) => entry.level <= depth && entry.level >= 2);
  if (entries.length === 0) return '';

  const title = str(node, 'title') ?? 'در این صفحه';
  const headingId = h.headingId(node.id);
  const items = entries.map((entry) => tag('li', {}, tag('a', { href: `#${entry.id}` }, escapeText(entry.text))));

  return tag('nav', { class: 'ds-toc', 'aria-labelledby': headingId }, [
    tag('h2', { class: 'ds-heading ds-heading--sm', id: headingId }, escapeText(h.text(title))),
    tag('ol', { role: 'list', class: 'ds-toc__list' }, items.join('')),
  ].join(''));
};

/* ------------------------------------------------------------------ داده */

const businessListRenderer: ComponentRenderer = (node, h) => {
  const title = str(node, 'title') ?? 'کسب‌وکارها';
  const headingId = h.headingId(node.id);
  const items = h.data.businesses;

  if (items.length === 0) {
    h.report({ rule: 'data.empty', severity: 'info', message: 'فهرست کسب‌وکارها خالی بود.', path: node.id });
    return '';
  }

  const cards = items.map((item) =>
    tag('article', { class: 'card' }, tag('a', { class: 'card__link', href: item.url }, [
      tag('h3', { class: 'card__title' }, escapeText(item.name)),
      item.cityName ? tag('p', { class: 'card__meta' }, escapeText(item.cityName)) : '',
      item.summary ? tag('p', { class: 'ds-text' }, escapeText(item.summary)) : '',
    ].join(''))),
  );

  return tag('section', { class: 'ds-block', 'aria-labelledby': headingId }, [
    tag('h2', { class: 'ds-heading', id: headingId }, escapeText(h.text(title))),
    tag('div', { class: classes('ds-grid', `ds-grid--${str(node, 'layout') === 'list' ? '1' : '3'}`, 'ds-grid--gap-md') }, cards.join('')),
  ].join(''));
};

const contentListRenderer: ComponentRenderer = (node, h) => {
  const title = str(node, 'title') ?? 'تازه‌ها';
  const headingId = h.headingId(node.id);
  const items = h.data.contents;

  if (items.length === 0) {
    h.report({ rule: 'data.empty', severity: 'info', message: 'فهرست محتوا خالی بود.', path: node.id });
    return '';
  }

  const cards = items.map((item) =>
    tag('article', { class: 'card' }, tag('a', { class: 'card__link', href: item.url }, [
      tag('h3', { class: 'card__title' }, escapeText(item.title)),
      item.publishedAt ? tag('p', { class: 'card__meta' }, timeTag(item.publishedAt, item.publishedAt.slice(0, 10))) : '',
      item.summary ? tag('p', { class: 'ds-text' }, escapeText(item.summary)) : '',
    ].join(''))),
  );

  return tag('section', { class: 'ds-block', 'aria-labelledby': headingId }, [
    tag('h2', { class: 'ds-heading', id: headingId }, escapeText(h.text(title))),
    tag('div', { class: classes('ds-grid', `ds-grid--${str(node, 'layout') === 'list' ? '1' : '3'}`, 'ds-grid--gap-md') }, cards.join('')),
  ].join(''));
};

/* ------------------------------------------------------------------ اجتماعی */

const SHARE_TARGETS: Record<string, (url: string) => string | null> = {
  telegram: (url) => `https://t.me/share/url?url=${encodeURIComponent(url)}`,
  whatsapp: (url) => `https://wa.me/?text=${encodeURIComponent(url)}`,
  linkedin: (url) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  email: (url) => `mailto:?body=${encodeURIComponent(url)}`,
};

const shareRenderer: ComponentRenderer = (node, h) => {
  const channels = strings(node, 'channels');
  const links: string[] = [];

  for (const channel of channels) {
    if (channel === 'copy') {
      /*
       * «رونوشت» بدون JavaScript ممکن نیست. جای‌گزینِ درست، حذف است — نه یک
       * دکمهٔ بی‌اثر که کاربر رویش بزند و هیچ نشود (§102).
       */
      h.report({ rule: 'component.needs_client_js', severity: 'info', message: 'کانال «رونوشت» به JavaScript نیاز دارد و حذف شد.', path: node.id });
      continue;
    }
    const build = SHARE_TARGETS[channel];
    if (!build) continue;
    const href = build(h.pageUrl);
    if (href === null) continue;
    links.push(link(href, channelLabel(channel), 'ds-share__link'));
  }

  if (links.length === 0) return '';

  return tag('nav', { class: 'ds-share', 'aria-label': h.text(str(node, 'label') ?? 'اشتراک‌گذاری') }, links.join(''));
};

function channelLabel(channel: string): string {
  const labels: Record<string, string> = {
    telegram: 'تلگرام',
    whatsapp: 'واتس‌اپ',
    linkedin: 'لینکدین',
    email: 'ایمیل',
  };
  return labels[channel] ?? channel;
}

/* ------------------------------------------------------------------ ابزارک */

const accordionRenderer: ComponentRenderer = (node, h) => {
  const items = list(node, 'items');
  if (items.length === 0) return '';
  const rendered = items.map((item) =>
    tag('details', { class: 'ds-accordion__item', open: item['open'] === true ? true : null }, [
      tag('summary', { class: 'ds-accordion__q' }, escapeText(h.text(item['title'] ?? ''))),
      tag('div', { class: 'ds-accordion__a' }, tag('p', { class: 'ds-text' }, escapeText(h.text(item['text'] ?? '')))),
    ].join('')),
  );
  return tag('div', { class: 'ds-accordion' }, rendered.join(''));
};

const dividerRenderer: ComponentRenderer = (node) =>
  tag('hr', {
    class: classes('ds-divider', `ds-divider--${str(node, 'style') ?? 'solid'}`, `ds-divider--${str(node, 'spacing') ?? 'md'}`),
  });

const spacerRenderer: ComponentRenderer = (node) => {
  const showOn = str(node, 'showOn') ?? 'all';
  const visibility = showOn === 'mobile' ? 'ds-spacer--mobile' : showOn === 'desktop' ? 'ds-spacer--desktop' : null;
  return tag('div', { class: classes('ds-spacer', `ds-spacer--${str(node, 'size') ?? 'md'}`, visibility), 'aria-hidden': 'true' });
};

const anchorNavRenderer: ComponentRenderer = (node, h) => {
  const items = list(node, 'items');
  if (items.length === 0) return '';
  const links = items
    .filter((item) => typeof item['label'] === 'string' && typeof item['anchor'] === 'string')
    .map((item) => tag('a', { class: 'ds-anchor-nav__link', href: `#${String(item['anchor']).replace(/[^\w\-.~:]/gu, '')}` }, escapeText(h.text(item['label']))));
  if (links.length === 0) return '';
  return tag('nav', { class: 'ds-anchor-nav', 'aria-label': 'ناوبری بخش‌ها' }, links.join(''));
};

/* ------------------------------------------------------------------ ثبت‌نام */

export const RENDERERS: Readonly<Record<string, ComponentRenderer>> = {
  'layout.section': sectionRenderer,
  'layout.grid': gridRenderer,
  'layout.columns': columnsRenderer,
  'form.contact_form':renderSchemaForm,
  'form.lead_form':renderSchemaForm,
  'form.newsletter':renderSchemaForm,
  'form.schema_form':renderSchemaForm,
  'data.crud_list':renderCrudList,
  'content.heading': headingRenderer,
  'content.paragraph': paragraphRenderer,
  'content.hero': heroRenderer,
  'content.button': buttonRenderer,
  'content.badge': badgeRenderer,
  'content.card': cardRenderer,
  'content.list': listRenderer,
  'content.feature_grid': featureGridRenderer,
  'content.stat': statRenderer,
  'content.pricing': pricingRenderer,
  'content.faq': faqRenderer,
  'content.quote': quoteRenderer,
  'content.callout': calloutRenderer,
  'content.steps': stepsRenderer,
  'content.table': tableRenderer,
  'content.cta_banner': ctaBannerRenderer,
  'content.contact_block': contactBlockRenderer,
  'content.map': mapRenderer,
  'media.image': imageRenderer,
  'media.gallery': galleryRenderer,
  'media.logo': logoRenderer,
  'media.video': videoRenderer,
  'navigation.breadcrumb': breadcrumbRenderer,
  'navigation.tabs': tabsRenderer,
  'navigation.toc': tocRenderer,
  'data.business_list': businessListRenderer,
  'data.content_list': contentListRenderer,
  'social.share': shareRenderer,
  'utility.accordion': accordionRenderer,
  'utility.divider': dividerRenderer,
  'utility.spacer': spacerRenderer,
  'utility.anchor_nav': anchorNavRenderer,
};

/**
 * کامپوننت‌های Registry که این build رندرشان نمی‌کند — **با دلیل صریح**.
 *
 * چرا فهرست جدا و چرا نه «پنهان‌سازی»: Addendum §۱۰۰ می‌گوید هیچ فیچری جزیره
 * نیست و §۱۰۲ می‌گوید هیچ چیز جعلی جای پیاده‌سازی نمی‌نشیند. فرم بدون نقطهٔ
 * پایانیِ ارسال، یا فهرست محصول بدون فروشگاه، **بخش نیمه‌کاره** می‌سازند؛ پس
 * آگاهانه حذف می‌شوند و در بازرسی طراحی، یافتهٔ «رندرنشده» ثبت می‌شود.
 */
export const UNRENDERABLE: Readonly<Record<string, string>> = {
  'data.search_box': 'صفحهٔ جست‌وجو هنوز ساخته نشده (گام ۳۳)',
  'data.price_table': 'دادهٔ قیمت محصول نیازمند فروشگاه است (گام ۳۴)',
  'commerce.product_grid': 'فروشگاه هنوز ساخته نشده (گام ۳۴)',
  'commerce.cart_button': 'سبد خرید نیازمند فروشگاه و کد کلاینت است (گام ۳۴)',
  'social.review_list': 'نظرات کاربران نیازمند مدل نظر است (گام ۳۳)',
};
