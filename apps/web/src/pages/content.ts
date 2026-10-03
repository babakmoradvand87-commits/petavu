/**
 * صفحهٔ محتوای سراسری پلتفرم — `/:slug` (گام ۲۲؛ §23، §132، Addendum §۲۶).
 *
 * بدنهٔ محتوا **متن ساختاریافته** است (JSON AST)، نه HTML. پس این‌جا یک
 * رندرکنندهٔ بلوک است: فقط شکل‌هایی که در فهرست مجازند ساخته می‌شوند و هر
 * `kind` ناشناخته، **رد می‌شود** — نه اینکه عبور کند و بعداً فیلتر شود.
 *
 * این همان مرزی است که §74 می‌کشد: کاربر می‌تواند ساختار بسازد، ولی نمی‌تواند
 * کدی برساند که اجرا شود. تگ‌ها این‌جا ساخته می‌شوند، از داده؛ نه از رشتهٔ
 * داده.
 */

import { buildHead, clampDescription } from '@petavu/seo';

import { breadcrumb, container, heading, paragraph, section } from '../components.js';
import { PLATFORM_NAME, renderShell } from '../chrome.js';
import { escapeText, type RawHtml } from '../html.js';
import { breadcrumbList, faqNode, jsonLdBlocks } from '../structured.js';
import { notFoundPage } from './system.js';
import type { PageContext, PageResponse } from './types.js';

interface Block {
  kind?: string;
  type?: string;
  text?: string;
  level?: number;
  items?: Array<string | { text?: string; title?: string }>;
  question?: string;
  answer?: string;
  label?: string;
  href?: string;
  rows?: Array<Array<string | number>>;
  headers?: string[];
}

/**
 * رندر بدنهٔ محتوا.
 *
 * خروجی `RawHtml` است و نه رشتهٔ ساده — علامتی عمدی: این خروجی از بلوک‌های
 * داده ساخته می‌شود و تنها جایی است که «ساختار داده» به «تگ» تبدیل می‌شود.
 * علامت‌دار بودنش، در بازبینی کد می‌گوید «اینجا با دقت نگاه کن».
 */
export function renderBlocks(body: unknown): RawHtml {
  const blocks = extractBlocks(body);
  const parts = blocks.map(renderBlock).filter((part): part is string => part !== '');
  return { __html: parts.join('\n') };
}

function extractBlocks(body: unknown): Block[] {
  if (body === null || typeof body !== 'object') return [];
  const candidate = body as { blocks?: unknown };
  if (!Array.isArray(candidate.blocks)) return [];
  return candidate.blocks.filter((block): block is Block => typeof block === 'object' && block !== null);
}

/** فقط شکل‌های مجاز؛ `html` و `script` و `embed` این‌جا **نیستند**. */
function renderBlock(block: Block): string {
  const kind = block.kind ?? block.type ?? '';
  switch (kind) {
    case 'heading': {
      const level = block.level === 3 || block.level === 4 ? block.level : 2;
      return `<h${level}>${escapeText(block.text ?? '')}</h${level}>`;
    }
    case 'paragraph':
      return `<p>${escapeText(block.text ?? '')}</p>`;
    case 'list': {
      const items = (block.items ?? []).map((item) =>
        typeof item === 'string' ? item : item.text ?? item.title ?? '',
      );
      return `<ul>${items.map((item) => `<li>${escapeText(item)}</li>`).join('')}</ul>`;
    }
    case 'quote':
      return `<blockquote>${escapeText(block.text ?? '')}</blockquote>`;
    case 'callout':
      return `<aside class="card card--quiet">${escapeText(block.text ?? '')}</aside>`;
    case 'faq': {
      const items = (block.items ?? [])
        .map((item) => {
          const entry = typeof item === 'string' ? { text: item } : item;
          const question = entry.title ?? entry.text ?? '';
          return question ? `<dt>${escapeText(question)}</dt><dd>${escapeText((entry as { answer?: string }).answer ?? '')}</dd>` : '';
        })
        .join('');
      return `<dl class="stack">${items}</dl>`;
    }
    case 'steps': {
      const items = (block.items ?? []).map((item) =>
        typeof item === 'string' ? item : item.text ?? item.title ?? '',
      );
      return `<ol>${items.map((item) => `<li>${escapeText(item)}</li>`).join('')}</ol>`;
    }
    case 'cta':
      return block.href
        ? `<p><a class="button button--primary" href="${escapeAttribute(block.href)}">${escapeText(block.label ?? 'ادامه')}</a></p>`
        : '';
    case 'table': {
      const headers = (block.headers ?? []).map((cell) => `<th scope="col">${escapeText(cell)}</th>`).join('');
      const rows = (block.rows ?? [])
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeText(String(cell))}</td>`).join('')}</tr>`)
        .join('');
      return `<div class="table-wrap"><table>${headers ? `<thead><tr>${headers}</tr></thead>` : ''}<tbody>${rows}</tbody></table></div>`;
    }
    case 'divider':
      return '<hr>';
    default:
      // ناشناخته = رد. سکوت این‌جا یعنی «بلوکی هست که نمی‌فهمیم»؛ پس می‌گوییم.
      return `<!-- بلوک ناشناخته رد شد: ${escapeText(kind)} -->`;
  }
}

function escapeAttribute(value: string): string {
  // مسیرهای داخلی مجازند؛ نشانی بیرونی هم مجاز است ولی ویژگی‌های خطرناک نه.
  const safe = value.trim().replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');
  return safe.startsWith('http') || safe.startsWith('/') || safe.startsWith('#') ? safe : '#';
}

export async function platformContentPage(context: PageContext, slug: string): Promise<PageResponse> {
  const { config, site, url, settings, requestId } = context;
  const origin = config.env.origins.public;
  const locale = settings?.default_locale ?? 'fa-IR';

  const page = await context.data.platformPage(slug, requestId);
  if (!page) return notFoundPage(context, { reason: 'content_not_found' });

  const canonical = `${origin}/${page.slug}`;
  const description = clampDescription(page.summary ?? page.subtitle ?? `${page.title} — ${PLATFORM_NAME}`);

  const headTags = buildHead({
    url: canonical,
    title: `${page.title} | ${PLATFORM_NAME}`,
    description,
    locale,
    indexable: site.indexable,
    environment: config.environment,
    og: { type: 'article', siteName: PLATFORM_NAME, locale },
  });

  const faqItems = extractFaqItems(page.body);

  const body = [
    section({ tight: true, children: container(breadcrumb([{ label: 'خانه', href: '/' }, { label: page.title }])) }),
    section({
      children: container(
        heading(1, page.title) +
          (page.subtitle ? paragraph(page.subtitle, 'card__meta') : '') +
          `<div class="prose section--tight">${renderBlocks(page.body).__html}</div>`,
      ),
    }),
  ].join('\n');

  const nodes = [
    breadcrumbList(
      [
        { name: 'خانه', url: '/' },
        { name: page.title, url: `/${page.slug}` },
      ],
      { baseUrl: origin, brandName: PLATFORM_NAME },
    ),
    ...(faqItems.length > 0 ? [faqNode(faqItems)] : []),
  ];

  const html = renderShell({
    config,
    site,
    url,
    siteName: PLATFORM_NAME,
    headTags,
    theme: context.theme,
    fonts: context.fonts,
    assets: context.assets,
    chrome: context.chrome,
    now: context.now,
    content: body,
    jsonLd: jsonLdBlocks({ baseUrl: origin, brandName: PLATFORM_NAME, locale, nodes }),
    bodyClass: 'page-content',
  });

  return { status: 200, kind: 'html', body: html };
}

function extractFaqItems(body: unknown): Array<{ question: string; answer: string }> {
  return extractBlocks(body).flatMap((block) => {
    if ((block.kind ?? block.type) !== 'faq') return [];
    return (block.items ?? []).flatMap((item) => {
      const entry = typeof item === 'string' ? { text: item } : item;
      const question = entry.title ?? entry.text ?? '';
      const answer = (entry as { answer?: string }).answer ?? '';
      return question && answer ? [{ question, answer }] : [];
    });
  });
}
