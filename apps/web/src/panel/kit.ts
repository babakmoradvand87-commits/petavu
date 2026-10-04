/**
 * اجزای HTML پنل (گام ۲۸؛ §45–۴۷، §68، §170–۱۷۵).
 *
 * همه از `tag`/`attrs` می‌گذرند (escape اجباری)؛ هیچ رشتهٔ HTML از دادهٔ خام ساخته نمی‌شود. بدون JavaScript و
 * بدون استایل درون‌خطی (CSP سخت). هدف لمس ۴۴ پیکسل، برچسب واقعی برای هر ورودی، و `aria-live` برای پیام‌ها.
 */

import { escapeText, raw, tag, voidTag, type RawHtml } from '../html.js';

export type Cell = string | number | null | undefined | RawHtml;

function cellHtml(cell: Cell): string {
  if (cell === null || cell === undefined || cell === '') return '<span class="muted">—</span>';
  if (typeof cell === 'object') return cell.__html;
  return escapeText(String(cell));
}

export function pageHeader(title: string, options: { subtitle?: string; actions?: string } = {}): string {
  return tag('header', { class: 'panel-head' }, [
    tag('div', {}, [tag('h1', { class: 'panel-head__title' }, escapeText(title)), options.subtitle ? tag('p', { class: 'panel-head__subtitle' }, escapeText(options.subtitle)) : ''].join('')),
    options.actions ? tag('div', { class: 'cluster' }, options.actions) : '',
  ].join(''));
}

export interface Flash {
  readonly kind: 'success' | 'error' | 'info';
  readonly text: string;
}

export function flashBlock(flash: Flash | null): string {
  if (!flash) return '';
  return tag('div', { class: `flash flash--${flash.kind}`, role: flash.kind === 'error' ? 'alert' : 'status' }, escapeText(flash.text));
}

export function card(title: string, body: string, options: { id?: string; tone?: 'plain' | 'quiet' } = {}): string {
  return tag('section', { class: `panel-card${options.tone === 'quiet' ? ' panel-card--quiet' : ''}`, id: options.id ?? null, 'aria-label': title }, [
    tag('h2', { class: 'panel-card__title' }, escapeText(title)),
    body,
  ].join(''));
}

export function emptyNote(text: string): string {
  return tag('p', { class: 'panel-empty' }, escapeText(text));
}

export function badgeFor(text: string, tone?: 'success' | 'warning' | 'danger' | 'neutral'): string {
  return tag('span', { class: tone ? `badge badge--${tone}` : 'badge' }, escapeText(text));
}

export interface Column {
  readonly key: string;
  readonly label: string;
}

export function dataTable(options: { caption: string; columns: readonly Column[]; rows: ReadonlyArray<Readonly<Record<string, Cell>>>; empty: string }): string {
  if (options.rows.length === 0) return emptyNote(options.empty);
  const head = options.columns.map((column) => tag('th', { scope: 'col' }, escapeText(column.label))).join('');
  const body = options.rows
    .map((row) => tag('tr', {}, options.columns.map((column) => tag('td', {}, cellHtml(row[column.key]))).join('')))
    .join('');
  return tag('div', { class: 'table-wrap' }, tag('table', { class: 'panel-table' }, [tag('caption', { class: 'visually-hidden' }, escapeText(options.caption)), tag('thead', {}, tag('tr', {}, head)), tag('tbody', {}, body)].join('')));
}

export function definitionList(pairs: ReadonlyArray<readonly [string, Cell]>): string {
  return tag('dl', { class: 'panel-dl' }, pairs.map(([term, value]) => `${tag('dt', {}, escapeText(term))}${tag('dd', {}, cellHtml(value))}`).join(''));
}

export function metricCard(label: string, value: string | number, hint?: string): string {
  return tag('div', { class: 'panel-metric' }, [
    tag('span', { class: 'panel-metric__label' }, escapeText(label)),
    tag('strong', { class: 'panel-metric__value' }, escapeText(String(value))),
    hint ? tag('span', { class: 'field__hint' }, escapeText(hint)) : '',
  ].join(''));
}

export interface Field {
  readonly name: string;
  readonly label: string;
  readonly type?: 'text' | 'password' | 'email' | 'textarea' | 'select' | 'hidden' | 'url';
  readonly value?: string | null;
  readonly required?: boolean;
  readonly hint?: string;
  readonly rows?: number;
  readonly maxLength?: number;
  readonly autocomplete?: string;
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly dir?: 'ltr' | 'rtl';
}

function fieldHtml(field: Field, index: number, formId: string): string {
  const id = `${formId}-${field.name}-${index}`;
  const type = field.type ?? 'text';
  if (type === 'hidden') return voidTag('input', { type: 'hidden', name: field.name, value: field.value ?? '' });

  const hintId = field.hint ? `${id}-hint` : null;
  const common = { id, name: field.name, required: field.required ? true : null, 'aria-describedby': hintId };
  let control: string;
  if (type === 'textarea') {
    control = tag('textarea', { ...common, class: 'input', rows: field.rows ?? 6, maxlength: field.maxLength ?? null, dir: field.dir ?? null }, escapeText(field.value ?? ''));
  } else if (type === 'select') {
    control = tag(
      'select',
      { ...common, class: 'input' },
      (field.options ?? []).map((option) => tag('option', { value: option.value, selected: option.value === (field.value ?? '') ? true : null }, escapeText(option.label))).join(''),
    );
  } else {
    control = voidTag('input', { ...common, class: 'input', type, value: field.value ?? '', maxlength: field.maxLength ?? null, autocomplete: field.autocomplete ?? null, dir: field.dir ?? null });
  }
  return tag('div', { class: 'field' }, [
    tag('label', { class: 'field__label', for: id }, escapeText(field.label) + (field.required ? ' <span aria-hidden="true">*</span>' : '')),
    control,
    field.hint ? tag('span', { class: 'field__hint', id: hintId }, escapeText(field.hint)) : '',
  ].join(''));
}

/** فرم POST با توکن CSRF پنهان. هر تغییر، یک فرم؛ بی‌JavaScript. */
export function formBlock(options: { id: string; action: string; csrf: string | null; fields: readonly Field[]; submit: string; tone?: 'primary' | 'danger' | 'ghost' }): string {
  const inputs = options.fields.map((field, index) => fieldHtml(field, index, options.id)).join('');
  return tag('form', { id: options.id, class: 'panel-form stack', method: 'post', action: options.action }, [
    options.csrf ? voidTag('input', { type: 'hidden', name: '_csrf', value: options.csrf }) : '',
    inputs,
    tag('div', {}, tag('button', { class: `button button--${options.tone ?? 'primary'}`, type: 'submit' }, escapeText(options.submit))),
  ].join(''));
}

/** دکمهٔ تک‌کاره (مثل «باطل کن»): یک فرم کوچک با فیلدهای پنهان. */
export function actionForm(options: { action: string; csrf: string | null; label: string; hidden?: Readonly<Record<string, string>>; tone?: 'primary' | 'danger' | 'ghost'; ariaLabel?: string }): RawHtml {
  return raw(
    tag('form', { class: 'inline-form', method: 'post', action: options.action }, [
      options.csrf ? voidTag('input', { type: 'hidden', name: '_csrf', value: options.csrf }) : '',
      ...Object.entries(options.hidden ?? {}).map(([name, value]) => voidTag('input', { type: 'hidden', name, value })),
      tag('button', { class: `button button--${options.tone ?? 'ghost'} button--small`, type: 'submit', 'aria-label': options.ariaLabel ?? null }, escapeText(options.label)),
    ].join('')),
  );
}

export function link(href: string, label: string, className = ''): RawHtml {
  return raw(tag('a', { href, class: className || null }, escapeText(label)));
}

export function htmlOf(...parts: Array<string | RawHtml | null | undefined | false>): string {
  return parts.map((part) => (typeof part === 'string' ? part : part ? part.__html : '')).join('');
}
