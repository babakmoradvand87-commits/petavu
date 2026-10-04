/**
 * اعتبارسنجی ورودی (گام ۲۱؛ §65، §74).
 *
 * چرا بدون کتابخانهٔ اعتبارسنجی: دو دلیل. اول اینکه خطای اعتبارسنجی باید
 * دقیقاً شکل `validation_failed` با `details.issues` را داشته باشد — همان
 * چیزی که کلاینت انتظار دارد؛ و این شکل، در `@petavu/shared` تعریف شده است.
 * دوم اینکه هر کتابخانهٔ تازه، یک سطح API و یک رفتار خطای تازه به مرز اضافه
 * می‌کند. این فایل کوچک است و رفتارش صریح.
 *
 * قاعدهٔ ثابت: **هیچ اعتبارسنجی‌ای جای مجوز را نمی‌گیرد.** این تابع‌ها فقط
 * می‌گویند «ورودی خوش‌شکل است»، نه «این کاربر اجازه دارد».
 */

import { AppError, isUuid } from '@petavu/shared';

export interface Issue {
  path: string;
  code: string;
}

export class Validator {
  private readonly issues: Issue[] = [];

  constructor(private readonly input: unknown) {}

  private fail(path: string, code: string): void {
    this.issues.push({ path, code });
  }

  /** پایان اعتبارسنجی: اگر خطایی جمع شده، یک خطای ساختاریافته می‌دهد. */
  done(): void {
    if (this.issues.length > 0) {
      throw new AppError('validation_failed', {
        message: 'اطلاعات ارسالی کامل یا درست نیست.',
        details: { issues: this.issues.slice(0, 20) },
      });
    }
  }

  raw(path: string): unknown {
    if (this.input === null || typeof this.input !== 'object' || Array.isArray(this.input)) return undefined;
    return (this.input as Record<string, unknown>)[path];
  }

  string(path: string, options: { min?: number; max?: number; trim?: boolean } = {}): string {
    const value = this.raw(path);
    if (typeof value !== 'string') {
      this.fail(path, 'expected_string');
      return '';
    }
    const text = options.trim === false ? value : value.trim();
    if (options.min !== undefined && text.length < options.min) this.fail(path, 'too_short');
    if (options.max !== undefined && text.length > options.max) this.fail(path, 'too_long');
    return text;
  }

  optionalString(path: string, options: { min?: number; max?: number } = {}): string | null {
    const value = this.raw(path);
    if (value === undefined || value === null || value === '') return null;
    return this.string(path, options);
  }

  uuid(path: string): string {
    const value = this.raw(path);
    if (typeof value !== 'string' || !isUuid(value)) {
      this.fail(path, 'expected_uuid');
      return '';
    }
    return value;
  }

  optionalUuid(path: string): string | null {
    const value = this.raw(path);
    if (value === undefined || value === null || value === '') return null;
    return this.uuid(path);
  }

  number(path:string,options:{min?:number;max?:number}={}):number{const value=this.raw(path);if(typeof value!=='number'||!Number.isFinite(value)||(options.min!==undefined&&value<options.min)||(options.max!==undefined&&value>options.max)){this.fail(path,'expected_number');return 0;}return value;}

  integer(path: string, options: { min?: number; max?: number; fallback?: number } = {}): number {
    const value = this.raw(path);
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
    if (!Number.isSafeInteger(parsed)) {
      this.fail(path, 'expected_integer');
      return options.fallback ?? 0;
    }
    if (options.min !== undefined && parsed < options.min) this.fail(path, 'too_small');
    if (options.max !== undefined && parsed > options.max) this.fail(path, 'too_large');
    return parsed;
  }

  /** عدد صحیح اختیاری؛ غایب یا تهی → `null`. */
  optionalInteger(path: string, options: { min?: number; max?: number } = {}): number | null {
    const value = this.raw(path);
    if (value === undefined || value === null || value === '') return null;
    return this.integer(path, options);
  }

  boolean(path: string, fallback = false): boolean {
    const value = this.raw(path);
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    this.fail(path, 'expected_boolean');
    return fallback;
  }

  object(path: string): Record<string, unknown> {
    const value = this.raw(path);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      this.fail(path, 'expected_object');
      return {};
    }
    return value as Record<string, unknown>;
  }

  optionalObject(path: string): Record<string, unknown> | null {
    const value = this.raw(path);
    if (value === undefined || value === null) return null;
    return this.object(path);
  }

  array<T = unknown>(path: string, options: { min?: number; max?: number } = {}): T[] {
    const value = this.raw(path);
    if (!Array.isArray(value)) {
      this.fail(path, 'expected_array');
      return [];
    }
    if (options.min !== undefined && value.length < options.min) this.fail(path, 'too_few');
    if (options.max !== undefined && value.length > options.max) this.fail(path, 'too_many');
    return value as T[];
  }

  /** فقط یکی از مقادیر مجاز؛ مقادیر نامجاز، صریح رد می‌شوند. */
  oneOf<T extends string>(path: string, allowed: readonly T[], fallback?: T): T {
    const value = this.raw(path);
    if (value === undefined || value === null || value === '') {
      if (fallback !== undefined) return fallback;
      this.fail(path, 'expected_value');
      return allowed[0] as T;
    }
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.fail(path, 'not_allowed');
      return fallback ?? (allowed[0] as T);
    }
    return value as T;
  }

  /** عدد در فهرست بستهٔ مجاز؛ برای کدهای وضعیت و مانند آن. */
  oneOfNumber(path: string, allowed: readonly number[], fallback?: number): number {
    const value = this.raw(path);
    if (value === undefined || value === null || value === '') {
      if (fallback !== undefined) return fallback;
      this.fail(path, 'expected_value');
      return allowed[0] as number;
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || !allowed.includes(parsed)) {
      this.fail(path, 'not_allowed');
      return fallback ?? (allowed[0] as number);
    }
    return parsed;
  }

  /** ISO 8601؛ بی‌آن، زمان‌بندی به «تاریخ نامعتبر» می‌رسد. */
  instant(path: string, options: { required?: boolean } = {}): string | null {
    const value = this.raw(path);
    if (value === undefined || value === null || value === '') {
      if (options.required) this.fail(path, 'required');
      return null;
    }
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      this.fail(path, 'expected_instant');
      return null;
    }
    return new Date(value).toISOString();
  }
}

/** ورودی بدنه را برای اعتبارسنجی آماده می‌کند؛ بدنهٔ غایب، شیء تهی است. */
export function validator(body: unknown): Validator {
  return new Validator(body ?? {});
}

/** فیلدهای اختیاری را از شیء حذف می‌کند تا `undefined` به SQL نرود. */
export function prune(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}
