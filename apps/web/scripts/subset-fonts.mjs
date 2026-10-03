#!/usr/bin/env node
/**
 * ساخت زیرمجموعهٔ فونت (گام ۲۲؛ Addendum §۵–۸).
 *
 * چرا این اسکریپت وجود دارد: فونت کامل وزیری، فارسی و لاتین و عربی و چند خط
 * دیگر را با خود دارد (~۲۴۰ کیلوبایت). صفحهٔ فارسی به همهٔ آن‌ها نیازی ندارد.
 * این اسکریپت، همان فونت **متغیر** را می‌گیرد و به بازه‌های نویسه‌ای واقعی سایت
 * محدود می‌کند و به WOFF2 تبدیل می‌کند.
 *
 * دو قاعدهٔ سخت:
 *   ۱) **فایل خروجی داخل مخزن می‌ماند.** اجرای این اسکریپت اختیاری است؛
 *      وب‌سرور به فایل واقعی روی دیسک تکیه می‌کند، نه به ابزار ساخت.
 *   ۲) **هیچ‌چیز جعل نمی‌شود.** اگر ابزار نبود، اسکریپت با صدای بلند شکست
 *      می‌خورد؛ فایل ساختگی نمی‌سازد (§102).
 *
 * اجرا:  node apps/web/scripts/subset-fonts.mjs /path/to/Vazirmatn[wght].ttf
 * منبع:  https://github.com/rastikerdar/vazirmatn  (مجوز SIL OFL 1.1 — همان
 *        فایل `assets/fonts/OFL.txt`)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const source = process.argv[2];
if (!source) {
  console.error('نشانی فایل TTF متغیر را بدهید: node apps/web/scripts/subset-fonts.mjs <file.ttf>');
  process.exit(2);
}

const here = new URL('..', import.meta.url).pathname;
const target = join(here, 'assets/fonts/vazirmatn-var.woff2');
const manifestPath = join(here, 'assets/fonts/manifest.json');

/*
 * بازه‌های نویسه‌ای، بر پایهٔ همان چیزی که سایت *واقعاً* چاپ می‌کند:
 *   • لاتین پایه و علائم سجاوندی و ارز
 *   • عربی/فارسی پایه، فرم‌های نمایشی (FDFF/FEFF) و شکل‌های اتصالی
 *   • نیم‌فاصله (200C) و علائم جهتی — بدون این‌ها، متن فارسی می‌شکند
 *   • ارقام فارسی/عربی و پرانتزها و علائم جهت نویسهٔ ریاضی
 */
const UNICODES = [
  'U+0020-007E', // لاتین پایه
  'U+00A0-00FF', // لاتین تکمیلی
  'U+0600-06FF', // عربی
  'U+0750-077F', // عربی تکمیلی
  'U+08A0-08FF', // عربی توسعه‌یافته
  'U+FB50-FDFF', // فرم‌های نمایشی عربی A
  'U+FE70-FEFF', // فرم‌های نمایشی عربی B
  'U+200C-200F', // نیم‌فاصله و علائم جهتی
  'U+2010-2015', // خط تیره‌ها
  'U+2018-201E', // نقل‌قول‌های تایپوگرافیک
  'U+2020-2022,U+2026', // درگ، گلوله، سه‌نقطه
  'U+2030,U+2039-203A,U+2044', // در هزار، گیومه، کسر
  'U+20AC,U+2190-2193,U+2212,U+2260', // یورو، فلش، علامت‌ها
].join(',');

execFileSync(
  'pyftsubset',
  [
    source,
    `--output-file=${target}`,
    '--flavor=woff2',
    `--unicodes=${UNICODES}`,
    // شکل‌دهی فارسی: `init/medi/fina/isol` و اتصالات و نشانه‌گذاری. بدون
    // این‌ها، حروف جدا از هم می‌آیند و متن فارسی ناخوانا می‌شود.
    '--layout-features=*',
    '--no-hinting',
    '--desubroutinize',
    '--drop-tables+=DSIG',
  ],
  { stdio: 'inherit' },
);

const bytes = readFileSync(target);
const manifest = {
  family: 'Vazirmatn',
  source: 'Vazirmatn v33.003 (variable, wght 100–900)',
  license: 'SIL OFL 1.1 — assets/fonts/OFL.txt',
  file: 'vazirmatn-var.woff2',
  bytes: statSync(target).size,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  unicode_ranges: UNICODES.split(','),
  built_at: new Date().toISOString(),
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`ساخته شد: ${target} (${manifest.bytes} بایت)`);
console.log(`درهم: ${manifest.sha256.slice(0, 16)}…`);
