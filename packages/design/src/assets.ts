/**
 * دارایی‌های محتوامحور (گام ۲۲؛ Addendum §۹–۱۲، §۸۷–۸۸).
 *
 * قاعده‌ای که این ماژول از آن می‌آید: **نشانی دارایی، درهم محتوایش را با خود
 * دارد** — `/assets/<نام>.<۸ نویسهٔ اول درهم>.<پسوند>`. پیامدها:
 *
 *   • کش مرورگر می‌تواند `immutable` و یک‌ساله باشد؛ تغییر محتوا، نشانی را عوض
 *     می‌کند و نشانی کهنه هرگز «نصفه‌تازه» تحویل نمی‌دهد.
 *   • نسخه‌بندی «حالت» نیست، واقعیتِ فایل است؛ کسی نمی‌تواند یادش برود.
 *   • وزن صفحه از خود فایل‌ها شمرده می‌شود (نه تخمین) — پایهٔ سنجش بودجه.
 *
 * فایل‌ها یک بار در آغاز خوانده و درهم می‌شوند؛ مسیر درخواست هیچ I/O ندارد.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

export const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export interface AssetEntry {
  /** نام فایل روی دیسک (بدون درهم). */
  readonly name: string;
  readonly base: string;
  readonly extension: string;
  /** درهم محتوا (sha256، کوتاه‌شده). */
  readonly hash: string;
  readonly bytes: number;
  readonly contentType: string;
  /** نشانی عمومی با درهم محتوا. */
  readonly url: string;
  /** مسیر مطلق روی دیسک؛ برای دارایی تولیدشده رشتهٔ خالی است. */
  readonly path: string;
}

export interface AssetRegistry {
  readonly entries: readonly AssetEntry[];
  /** نشانی دارایی از نام خام. نبودِ فایل ⇒ خطای صریح، نه نشانی خالی. */
  url(name: string): string;
  find(name: string): AssetEntry | undefined;
  /** مجموع بایت‌های یک فهرست دارایی — پایهٔ سنجش بودجهٔ وزن. */
  totalBytes(names: readonly string[]): number;
  /** CSS/JS تولیدشدهٔ در حافظه را هم درهم‌دار و سرو می‌کند. */
  registerGenerated(name: string, body: string, contentType: string): AssetEntry;
  /** یافتن دارایی با نشانی عمومی (همان‌طور که مرورگر می‌پرسد). */
  resolve(publicPath: string): AssetEntry | undefined;
  /** بدنهٔ دارایی؛ برای فایل‌های دیسکی هم فقط از همین راه داده می‌شود. */
  body(entry: AssetEntry): Buffer;
}

function contentTypeFor(extension: string): string {
  const type = CONTENT_TYPES[extension.toLowerCase()];
  if (!type) throw new Error(`پسوند ناشناخته در دارایی‌ها: ${extension}`);
  return type;
}

function walk(directory: string): Array<{ name: string; base: string; extension: string; path: string }> {
  const found: Array<{ name: string; base: string; extension: string; path: string }> = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full));
      continue;
    }
    if (!entry.isFile()) continue;

    const extension = extname(entry.name).toLowerCase();
    /*
     * مجوز فونت و فایل‌های متنی، دارایی عمومی نیستند: نباید زیر `/assets`
     * سرو شوند (نه از وسواس؛ `OFL.txt` هیچ مصرفی در صفحه ندارد و هر مسیر
     * سروشده، سطح حملهٔ تازه است).
     */
    if (extension === '.txt' || extension === '.md') continue;
    contentTypeFor(extension);

    found.push({
      name: entry.name,
      base: entry.name.slice(0, -extension.length),
      extension,
      path: full,
    });
  }

  return found;
}

export function createAssetRegistry(options: { directory: string; prefix?: string; hashLength?: number }): AssetRegistry {
  const prefix = options.prefix ?? '/assets';
  const hashLength = options.hashLength ?? 8;
  const byName = new Map<string, AssetEntry>();
  const byUrl = new Map<string, AssetEntry>();
  const bodies = new Map<string, Buffer>();

  const remember = (entry: AssetEntry, body: Buffer): AssetEntry => {
    byName.set(entry.name, entry);
    byUrl.set(entry.url, entry);
    bodies.set(entry.url, body);
    return entry;
  };

  for (const file of walk(options.directory)) {
    const body = readFileSync(file.path);
    const hash = createHash('sha256').update(body).digest('hex').slice(0, hashLength);
    remember(
      {
        ...file,
        hash,
        bytes: body.byteLength,
        contentType: contentTypeFor(file.extension),
        url: `${prefix}/${file.base}.${hash}${file.extension}`,
      },
      body,
    );
  }

  const registry: AssetRegistry = {
    get entries() {
      return [...byName.values()];
    },

    find(name) {
      return byName.get(name);
    },

    url(name) {
      const entry = byName.get(name);
      if (!entry) throw new Error(`دارایی ناشناخته: ${name}`);
      return entry.url;
    },

    totalBytes(names) {
      return names.reduce((sum, name) => sum + (byName.get(name)?.bytes ?? 0), 0);
    },

    registerGenerated(name, body, contentType) {
      const bytes = Buffer.from(body, 'utf8');
      const extension = extname(name).toLowerCase();
      const base = name.slice(0, -extension.length);
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, hashLength);
      return remember(
        {
          name,
          base,
          extension,
          hash,
          bytes: bytes.byteLength,
          contentType,
          url: `${prefix}/${base}.${hash}${extension}`,
          path: '',
        },
        bytes,
      );
    },

    resolve(publicPath) {
      return byUrl.get(publicPath);
    },

    body(entry) {
      const body = bodies.get(entry.url);
      if (!body) throw new Error(`بدنهٔ دارایی در دسترس نیست: ${entry.name}`);
      return body;
    },
  };

  return registry;
}
