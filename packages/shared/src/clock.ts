/**
 * زمان و شناسه — §7، §20
 *
 * دو تصمیم که در کل سیستم تکرار می‌شود:
 *
 *   ۱. همه‌جا `Date` UTC است. زمان محلی فقط در لحظهٔ نمایش، و آن هم بر پایهٔ
 *      منطقهٔ زمانی کسب‌وکار، ساخته می‌شود. اگر زمان را در دامنه با منطقهٔ
 *      زمانی ذخیره کنیم، هر مقایسه و هر ایندکس شکننده می‌شود.
 *   ۲. زمان از یک منبع واحد می‌آید. تست‌ها ساعت را جلو می‌برند؛ کد دامنه هیچ
 *      جای دیگری `Date.now()` صدا نمی‌زند.
 */

export type IsoInstant = string;

export interface Clock {
  /** زمان کنونی به میلی‌ثانیه از مبدأ. */
  now(): number;
  date(): Date;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  date: () => new Date(),
};

/** ساعتی که تست می‌تواند دستی جلو ببرد. */
export function fixedClock(startMs: number): Clock & { advance(ms: number): void; set(ms: number): void } {
  let current = startMs;
  return {
    now: () => current,
    date: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
    set: (ms: number) => {
      current = ms;
    },
  };
}

export function toIso(date: Date): IsoInstant {
  return date.toISOString();
}

export function fromIso(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`زمان نامعتبر: «${value}»`);
  return date;
}

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** `now + 15m` — برای انقضای نشست، توکن و قفل. */
export function addDuration(clock: Clock, ms: number): Date {
  return new Date(clock.now() + ms);
}

export function isExpired(clock: Clock, expiresAt: string | Date): boolean {
  const value = typeof expiresAt === 'string' ? fromIso(expiresAt) : expiresAt;
  return value.getTime() <= clock.now();
}
