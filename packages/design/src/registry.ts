/**
 * اتصال Registry کامپوننت‌ها به رندر (گام ۲۳؛ §35، §43، §161–۱۶۹).
 *
 * منبع حقیقت عناصر مجاز، جدول `design.component` است — نه این فایل. این ماژول
 * فقط آن ردیف‌ها را به یک قرارداد قابل‌اجرا تبدیل می‌کند: چه پراپ‌هایی مجازند،
 * چه نوعی دارند، کدام اسلات فرزند می‌پذیرد، و هر کامپوننت چقدر وزن دارد.
 *
 * دو قاعده‌ای که اینجا اعمال می‌شود و جای دیگری اعمال **نمی‌شود**:
 *
 *   ۱. **هر پراپ، پیش از رندر اعتبارسنجی می‌شود.** پراپِ ناشناخته دور ریخته
 *      می‌شود (با یافتهٔ ثبت‌شده). علتش روشن است: درخت صفحه داده‌ای است که از
 *      بیرون می‌آید؛ اگر رندرکننده هر کلیدی را بپذیرد، درخت به یک کانال تزریق
 *      تبدیل می‌شود و «داده، داده است» دیگر برقرار نیست.
 *   ۲. **کلیدهای ظاهری (`style`، `class`) و هر `on*` پذیرفته نمی‌شوند.** ظاهر از
 *      توکن‌های `design.token` می‌آید؛ اگر درخت بتواند رنگ و چیدمان دلخواه بگذارد،
 *      Design System فقط یک توصیه است، نه یک قید — و CSP سخت هم بی‌اثر می‌شود.
 */

/** یافتهٔ ساختاری — همان شکل `design.validate_tree`، تا دو مسیر واژگان یکسان داشته باشند. */
export interface Finding {
  readonly rule: string;
  readonly severity: 'info' | 'warning' | 'error' | 'blocker';
  readonly message: string;
  readonly path?: string | null;
}

export type PropType =
  | 'string'
  | 'longtext'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'url'
  | 'array'
  | 'object'
  | 'cta'
  | 'asset';

export interface PropSpec {
  readonly type: PropType;
  readonly required?: boolean;
  readonly default?: unknown;
  readonly enum?: readonly string[];
  readonly items?: 'string' | 'object' | 'array';
  readonly fields?: Readonly<Record<string, PropType>>;
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: string;
}

export interface SlotSpec {
  readonly multiple?: boolean;
  readonly allowed?: readonly string[];
  readonly max?: number;
}

export interface ComponentPerformance {
  readonly weightKb: number;
  readonly affectsLcp: boolean;
  readonly queriesDatabase: boolean;
  readonly requiresClientJs: boolean;
  readonly thirdParty: boolean;
  readonly loadingStrategy: string | null;
}

export interface ComponentSpec {
  readonly key: string;
  readonly nameFa: string;
  readonly category: string;
  readonly status: string;
  readonly propsSchema: Readonly<Record<string, PropSpec>>;
  readonly slots: Readonly<Record<string, SlotSpec>>;
  readonly a11y: Readonly<Record<string, unknown>>;
  readonly seo: Readonly<Record<string, unknown>>;
  readonly performance: ComponentPerformance;
}

export interface ComponentRegistry {
  readonly size: number;
  readonly keys: readonly string[];
  get(key: string): ComponentSpec | undefined;
  has(key: string): boolean;
}

/** ردیف خام `design.component`؛ `jsonb` ممکن است رشته یا شیء برسد. */
export interface RegistryRow extends Record<string, unknown> {
  readonly key: unknown;
  readonly name_fa?: unknown;
  readonly category?: unknown;
  readonly status?: unknown;
  readonly props_schema?: unknown;
  readonly slots?: unknown;
  readonly a11y?: unknown;
  readonly seo?: unknown;
  readonly performance?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

const PROP_TYPES = new Set<PropType>([
  'string', 'longtext', 'number', 'boolean', 'enum', 'url', 'array', 'object', 'cta', 'asset',
]);

function toPropType(value: unknown): PropType {
  return typeof value === 'string' && PROP_TYPES.has(value as PropType) ? (value as PropType) : 'string';
}

function parsePropsSchema(value: unknown): Record<string, PropSpec> {
  const raw = asRecord(value);
  const schema: Record<string, PropSpec> = {};

  for (const [key, specValue] of Object.entries(raw)) {
    const spec = asRecord(specValue);
    const allowed = Array.isArray(spec['enum'])
      ? spec['enum'].filter((item): item is string => typeof item === 'string')
      : undefined;
    const fieldsRaw = asRecord(spec['fields']);
    const fields: Record<string, PropType> = {};
    for (const [fieldKey, fieldType] of Object.entries(fieldsRaw)) fields[fieldKey] = toPropType(fieldType);

    schema[key] = {
      type: toPropType(spec['type']),
      required: spec['required'] === true,
      default: spec['default'],
      enum: allowed,
      items: spec['items'] === 'string' || spec['items'] === 'object' || spec['items'] === 'array' ? spec['items'] : undefined,
      fields: Object.keys(fields).length > 0 ? fields : undefined,
      min: typeof spec['min'] === 'number' ? spec['min'] : undefined,
      max: typeof spec['max'] === 'number' ? spec['max'] : undefined,
      pattern: typeof spec['pattern'] === 'string' ? spec['pattern'] : undefined,
    };
  }

  return schema;
}

function parseSlots(value: unknown): Record<string, SlotSpec> {
  const raw = asRecord(value);
  const slots: Record<string, SlotSpec> = {};
  for (const [key, slotValue] of Object.entries(raw)) {
    const slot = asRecord(slotValue);
    slots[key] = {
      multiple: slot['multiple'] === true,
      allowed: Array.isArray(slot['allowed']) ? slot['allowed'].filter((item): item is string => typeof item === 'string') : undefined,
      max: typeof slot['max'] === 'number' ? slot['max'] : undefined,
    };
  }
  return slots;
}

function parsePerformance(value: unknown): ComponentPerformance {
  const raw = asRecord(value);
  const number = (input: unknown): number => (typeof input === 'number' && Number.isFinite(input) ? input : 0);
  return {
    weightKb: number(raw['weight_kb']),
    affectsLcp: raw['affects_lcp'] === true,
    queriesDatabase: raw['queriesDatabase'] === true,
    requiresClientJs: raw['requiresClientJs'] === true,
    thirdParty: raw['thirdParty'] === true,
    loadingStrategy: typeof raw['loadingStrategy'] === 'string' ? raw['loadingStrategy'] : null,
  };
}

export function parseRegistryRow(row: RegistryRow): ComponentSpec {
  return {
    key: String(row.key),
    nameFa: typeof row.name_fa === 'string' ? row.name_fa : String(row.key),
    category: typeof row.category === 'string' ? row.category : 'utility',
    status: typeof row.status === 'string' ? row.status : 'active',
    propsSchema: parsePropsSchema(row.props_schema),
    slots: parseSlots(row.slots),
    a11y: asRecord(row.a11y),
    seo: asRecord(row.seo),
    performance: parsePerformance(row.performance),
  };
}

export function createRegistry(rows: readonly RegistryRow[]): ComponentRegistry {
  const map = new Map<string, ComponentSpec>();
  for (const row of rows) {
    if (row.key === null || row.key === undefined) continue;
    const spec = parseRegistryRow(row);
    map.set(spec.key, spec);
  }

  return {
    size: map.size,
    keys: [...map.keys()],
    get: (key) => map.get(key),
    has: (key) => map.has(key),
  };
}

/** پروپ‌هایی که هرگز از درخت پذیرفته نمی‌شوند — مرز امنیتی، نه سلیقه. */
const FORBIDDEN_PROP_KEYS = new Set(['style', 'class', 'id', 'innerhtml', 'srcdoc', 'dangerouslysetinnerhtml', 'raw', 'rawhtml']);

export interface PropValidation {
  readonly props: Record<string, unknown>;
  readonly findings: readonly Finding[];
}

const MAX_ARRAY_ITEMS = 50;
const MAX_STRING = 4000;

/**
 * اعتبارسنجی پراپ‌ها بر پایهٔ `props_schema` همان کامپوننت.
 *
 * خروجی، **مجموعهٔ پاک‌شدهٔ** پراپ‌هاست: رندرکننده هرگز پراپ خام نمی‌بیند. هر
 * چیزی که رد شود، یک یافته دارد؛ پس «چه چیزی و چرا حذف شد» پرسش‌پذیر است.
 */
export function validateProps(
  spec: ComponentSpec,
  input: unknown,
  path: string,
): PropValidation {
  const findings: Finding[] = [];
  const raw = asRecord(input);
  const props: Record<string, unknown> = {};

  /*
   * اول، درخت را از کلیدهای ممنوع پاک می‌کنیم — حتی اگر در `props_schema` نباشند.
   * اینجا هشدار بی‌صدا نیست: یافته ثبت می‌شود تا در بازرسی طراحی دیده شود.
   */
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_PROP_KEYS.has(key.toLowerCase()) || key.toLowerCase().startsWith('on')) {
      findings.push({
        rule: 'security.presentation_prop_ignored',
        severity: 'warning',
        message: `پراپ «${key}» از درخت پذیرفته نمی‌شود؛ ظاهر فقط از توکن‌های طراحی می‌آید.`,
        path,
      });
    }
  }

  for (const [key, propSpec] of Object.entries(spec.propsSchema)) {
    const provided = raw[key];
    const value = provided === undefined ? propSpec.default : provided;

    if (value === undefined || value === null || value === '') {
      if (propSpec.required) {
        findings.push({
          rule: 'structure.required_prop_missing',
          severity: 'error',
          message: `پراپ الزامی «${key}» در کامپوننت «${spec.key}» حاضر نیست.`,
          path,
        });
      }
      continue;
    }

    const checked = checkValue(key, propSpec, value, path, findings);
    if (checked !== undefined) {
      props[key] = checked;
    } else if (propSpec.default !== undefined) {
      /*
       * مقدار رد‌شده، به **پیش‌فرض اعلام‌شدهٔ Registry** برمی‌گردد — نه به
       * «هیچ». تفاوت مهم است: کامپوننت با مقدار پیش‌فرض، رندر درست و
       * قابل‌پیش‌بینی می‌دهد؛ با مقدار غایب، رفتارش به رندرکننده واگذار می‌شود.
       */
      props[key] = propSpec.default;
    }
  }

  return { props, findings };
}

function checkValue(
  key: string,
  propSpec: PropSpec,
  value: unknown,
  path: string,
  findings: Finding[],
): unknown {
  const reject = (rule: string, message: string): undefined => {
    findings.push({ rule, severity: 'warning', message, path });
    return undefined;
  };

  switch (propSpec.type) {
    case 'string':
    case 'longtext': {
      if (typeof value !== 'string') return reject('structure.prop_type_mismatch', `پراپ «${key}» باید متن باشد.`);
      const limit = propSpec.type === 'string' ? 600 : MAX_STRING;
      if (value.length > limit) return reject('structure.prop_too_long', `پراپ «${key}» بیش از حد بلند است (${value.length} > ${limit}).`);
      if (containsControlChars(value)) return reject('security.control_chars', `پراپ «${key}» نویسهٔ کنترلی دارد.`);
      if (propSpec.pattern && !new RegExp(propSpec.pattern, 'u').test(value)) {
        return reject('structure.prop_pattern', `پراپ «${key}» با الگوی تعریف‌شده نمی‌خواند.`);
      }
      return value;
    }

    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return reject('structure.prop_type_mismatch', `پراپ «${key}» باید عدد باشد.`);
      if (propSpec.min !== undefined && value < propSpec.min) return reject('structure.prop_range', `پراپ «${key}» کوچک‌تر از کمینهٔ مجاز است.`);
      if (propSpec.max !== undefined && value > propSpec.max) return reject('structure.prop_range', `پراپ «${key}» بزرگ‌تر از بیشینهٔ مجاز است.`);
      return value;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') return reject('structure.prop_type_mismatch', `پراپ «${key}» باید منطقی باشد.`);
      return value;
    }

    case 'enum': {
      const allowed = propSpec.enum ?? [];
      /*
       * `enum` در طرح، گاهی عدد را هم می‌پذیرد (`"2"`) چون از منوی انتخاب
       * می‌آید. هر دو شکل را می‌پذیریم ولی خروجی را به رشته نرمال می‌کنیم تا
       * کلاس CSS همیشه یک شکل داشته باشد.
       */
      const normalized = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;
      if (normalized === null || !allowed.includes(normalized)) {
        return reject('structure.prop_enum', `پراپ «${key}» یکی از مقادیر مجاز نیست.`);
      }
      return normalized;
    }

    case 'url':
      return sanitizeUrlProp(value, key, path, findings, reject);

    case 'asset': {
      if (typeof value !== 'string') return reject('structure.prop_type_mismatch', `پراپ «${key}» باید شناسهٔ دارایی باشد.`);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        return reject('structure.prop_type_mismatch', `پراپ «${key}» شناسهٔ دارایی معتبر نیست.`);
      }
      return value.toLowerCase();
    }

    case 'cta': {
      const cta = asRecord(value);
      const label = typeof cta['label'] === 'string' ? cta['label'] : null;
      if (label === null || label.trim() === '') return reject('structure.required_prop_missing', `کنش «${key}» برچسب ندارد.`);
      const href = cta['href'] === undefined ? null : sanitizeHref(cta['href']);
      if (cta['href'] !== undefined && href === null) {
        return reject('security.href_rejected', `نشانی کنش «${key}» پذیرفته نشد.`);
      }
      return { label: label.slice(0, 120), href };
    }

    case 'array':
      return checkArray(key, propSpec, value, path, findings, reject);

    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return reject('structure.prop_type_mismatch', `پراپ «${key}» باید شیء باشد.`);
      }
      return checkObjectFields(value as Record<string, unknown>, propSpec, path, findings);
    }

    default:
      return reject('structure.prop_type_unknown', `نوع پراپ «${key}» پشتیبانی نمی‌شود.`);
  }
}

function checkArray(
  key: string,
  propSpec: PropSpec,
  value: unknown,
  path: string,
  findings: Finding[],
  reject: (rule: string, message: string) => undefined,
): unknown {
  if (!Array.isArray(value)) return reject('structure.prop_type_mismatch', `پراپ «${key}» باید آرایه باشد.`);
  if (value.length > MAX_ARRAY_ITEMS) {
    findings.push({
      rule: 'structure.array_truncated',
      severity: 'warning',
      message: `پراپ «${key}» بیش از ${MAX_ARRAY_ITEMS} عضو داشت و بریده شد.`,
      path,
    });
  }

  const items = value.slice(0, MAX_ARRAY_ITEMS);
  const out: unknown[] = [];

  for (const item of items) {
    if (propSpec.items === 'string') {
      if (typeof item !== 'string' || item.length > 600) {
        findings.push({ rule: 'structure.prop_type_mismatch', severity: 'warning', message: `عضوی از «${key}» متن معتبر نیست.`, path });
        continue;
      }
      out.push(item);
      continue;
    }

    if (propSpec.items === 'array') {
      if (!Array.isArray(item) || item.some((cell) => typeof cell !== 'string')) {
        findings.push({ rule: 'structure.prop_type_mismatch', severity: 'warning', message: `سطر «${key}» آرایه‌ای از متن نیست.`, path });
        continue;
      }
      out.push(item.slice(0, 20).map((cell) => String(cell).slice(0, 600)));
      continue;
    }

    // `items: 'object'` — هر عضو با `fields` همان آرایه سنجیده می‌شود.
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      findings.push({ rule: 'structure.prop_type_mismatch', severity: 'warning', message: `عضوی از «${key}» شیء نیست.`, path });
      continue;
    }
    out.push(checkObjectFields(item as Record<string, unknown>, propSpec, path, findings));
  }

  return out;
}

/** اعتبارسنجی فیلدهای یک شیء (پراپ `object` یا عضو آرایه). */
function checkObjectFields(
  input: Record<string, unknown>,
  propSpec: PropSpec,
  path: string,
  findings: Finding[],
): Record<string, unknown> {
  const fields = propSpec.fields ?? {};
  const out: Record<string, unknown> = {};

  for (const [fieldKey, fieldType] of Object.entries(fields)) {
    const value = input[fieldKey];
    if (value === undefined || value === null || value === '') continue;

    if (fieldType === 'asset') {
      if (typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)) out[fieldKey] = value.toLowerCase();
      continue;
    }

    if (fieldType === 'url') {
      const href = sanitizeHref(value);
      if (href === null) {
        findings.push({ rule: 'security.href_rejected', severity: 'warning', message: `نشانی «${fieldKey}» پذیرفته نشد.`, path });
        continue;
      }
      out[fieldKey] = href;
      continue;
    }

    if (fieldType === 'boolean') {
      if (typeof value === 'boolean') out[fieldKey] = value;
      continue;
    }

    if (fieldType === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) out[fieldKey] = value;
      continue;
    }

    // متن و متن بلند: هم‌ارز `string`/`longtext`.
    if (typeof value === 'string') {
      if (!containsControlChars(value)) out[fieldKey] = value.slice(0, MAX_STRING);
      continue;
    }

    if (Array.isArray(value)) {
      out[fieldKey] = value
        .slice(0, MAX_ARRAY_ITEMS)
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.slice(0, 600));
    }
  }

  return out;
}

function sanitizeUrlProp(
  value: unknown,
  key: string,
  path: string,
  findings: Finding[],
  reject: (rule: string, message: string) => undefined,
): unknown {
  if (typeof value !== 'string') return reject('structure.prop_type_mismatch', `پراپ «${key}» باید نشانی باشد.`);
  const href = sanitizeHref(value);
  if (href === null) return reject('security.href_rejected', `نشانی «${key}» پذیرفته نشد.`);
  void findings;
  void path;
  return href;
}

/**
 * تنها دروازهٔ نشانی‌ها.
 *
 * چه چیزی رد می‌شود و چرا:
 *   • `javascript:`/`data:`/`vbscript:`/`blob:` — تزریق کد از مسیر پیوند.
 *   • `//host/path` و `/\host` — نشانی «بی‌طرح»، که مرورگر آن را بیرونی می‌گیرد.
 *   • هر طرح ناشناخته.
 *
 * طرح‌های مجاز: مسیر هم‌مبدأ، قطعه (`#`)، `mailto:`، `tel:`، و `http(s):` مطلق.
 * نشانی مطلق، در `renderers` با `rel="noopener noreferrer nofollow"` چاپ می‌شود.
 */
export function sanitizeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  if (href === '' || href.length > 2000) return null;
  if (containsControlChars(href)) return null;

  if (href.startsWith('#')) return /^#[\w\-.~:]{0,120}$/u.test(href) ? href : null;

  if (href.startsWith('/')) {
    if (href.startsWith('//') || href.startsWith('/\\')) return null;
    return href;
  }

  if (/^(mailto|tel):/i.test(href)) {
    return /^(mailto:[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}|tel:\+?[0-9\-\s()]{3,25})$/i.test(href) ? href : null;
  }

  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if (url.username !== '' || url.password !== '') return null;
      return url.toString().slice(0, 2000);
    } catch {
      return null;
    }
  }

  return null;
}

function containsControlChars(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

/** پیام یافته‌ها برای لاگ — ساختار را حفظ می‌کند تا بعداً ماشین‌خوان بمانَد. */
export function findingsDigest(findings: readonly Finding[]): string {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1);
  return [...counts.entries()].map(([rule, count]) => `${rule}×${count}`).join(' ');
}

/* ------------------------------------------------------------------ کش Registry */

export interface RegistryCacheOptions {
  /** عمر کش؛ Registry کم‌تغییر است ولی «همیشه» غلط است. */
  readonly ttlMs?: number;
  readonly load: () => Promise<readonly RegistryRow[]>;
  readonly onError?: (error: unknown) => void;
}

export interface RegistryCache {
  get(): Promise<ComponentRegistry>;
  /** ساخت دوبارهٔ کش — پس از تغییر Registry (انتشار نسخهٔ تازه). */
  invalidate(): void;
}

/**
 * کش خواندنیِ Registry با عمر محدود.
 *
 * چرا کش اصلاً لازم است: Registry در رندر **هر گره** لازم می‌شود و خواندنش در
 * هر درخواست، یک رفت‌وبرگشت اضافه به پایگاه‌داده است (Addendum §۲: کش
 * چندلایه). چرا عمر دارد: Registry با انتشار نسخهٔ تازهٔ طراحی عوض می‌شود؛
 * کشِ بی‌مرز یعنی صفحهٔ منتشرشده با رندرکنندهٔ قدیمی تفسیر شود.
 */
export function createRegistryCache(options: RegistryCacheOptions): RegistryCache {
  const ttlMs = options.ttlMs ?? 30_000;
  let cached: { registry: ComponentRegistry; at: number } | null = null;
  let inFlight: Promise<ComponentRegistry> | null = null;

  return {
    async get(): Promise<ComponentRegistry> {
      const now = Date.now();
      if (cached && now - cached.at < ttlMs) return cached.registry;
      if (inFlight) return inFlight;

      inFlight = (async () => {
        try {
          const registry = createRegistry(await options.load());
          cached = { registry, at: Date.now() };
          return registry;
        } catch (error) {
          options.onError?.(error);
          /*
           * شکست خواندن، Registry قبلی را نگه می‌دارد. رندر با Registry
           * «تازه‌نشده» بهتر از رندر با Registry خالی است: در حالت دوم، هر
           * صفحهٔ ساخته‌شده از درخت، ناگهان به چیدمان پایه برمی‌گردد.
           */
          return cached?.registry ?? createRegistry([]);
        } finally {
          inFlight = null;
        }
      })();

      return inFlight;
    },

    invalidate(): void {
      cached = null;
    },
  };
}
