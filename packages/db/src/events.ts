/**
 * رخداد و حسابرسی، از لایهٔ داده (§23–۲۴، §93–۹۴؛ Addendum §56–۷۲).
 *
 * این توابع، پیاده‌سازی ندارند و نباید داشته باشند: ثبت در پایگاه‌داده انجام
 * می‌شود، در همان تراکنش. دو دلیل:
 *
 *   ۱. **اتمی بودن.** اگر رخداد بیرون از تراکنش ثبت شود، یا رخداد برای تغییر
 *      انجام‌نشده می‌ماند یا تغییر بدون رخداد. هر دو، داده را دروغگو می‌کند.
 *   ۲. **ترتیب و بازیگر.** بازیگر از زمینهٔ همان تراکنش می‌آید؛ پس رخداد
 *      می‌تواند بگوید «کی، از طرف کی، در کدام درخواست».
 */

import type { SqlClient } from './types.js';
import { sql } from './sql.js';

export interface EmitEventInput {
  eventType: string;
  entityType: string;
  entityId: string;
  businessId?: string | null;
  payload?: Record<string, unknown>;
  actorType?: 'user' | 'system' | 'worker' | 'impersonator' | null;
}

/**
 * ثبت رخداد دامنه.
 *
 * کد رخداد از الگوی `domain.action` پیروی می‌کند؛ همین الگو در قاعده‌های
 * خودکارسازی و در پخش وبهوک به کار می‌آید.
 */
export async function emitEvent(client: SqlClient, input: EmitEventInput): Promise<string> {
  const result = await client.query<{ id: string }>(
    sql`select app.emit_event(${input.eventType}, ${input.entityType}, ${input.entityId}, ${input.businessId ?? null}, ${JSON.stringify(input.payload ?? {})}::jsonb, ${input.actorType ?? null}) as id`.text,
    sql`select app.emit_event(${input.eventType}, ${input.entityType}, ${input.entityId}, ${input.businessId ?? null}, ${JSON.stringify(input.payload ?? {})}::jsonb, ${input.actorType ?? null}) as id`.params,
  );
  return String(result.rows[0]?.id ?? '');
}

export interface RecordAuditInput {
  action: string;
  entityType: string;
  entityId: string;
  businessId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

/** ثبت رد حسابرسی. حسابرسی، سابقه است: ویرایش و حذف در پایگاه‌داده ممنوع است. */
export async function recordAudit(client: SqlClient, input: RecordAuditInput): Promise<string> {
  const fragment = sql`select app.record_audit(${input.action}, ${input.entityType}, ${input.entityId}, ${input.businessId ?? null},
    ${input.before ? JSON.stringify(input.before) : null}::jsonb,
    ${input.after ? JSON.stringify(input.after) : null}::jsonb,
    ${JSON.stringify(input.metadata ?? {})}::jsonb) as id`;
  const result = await client.query<{ id: string }>(fragment.text, fragment.params);
  return String(result.rows[0]?.id ?? '');
}
