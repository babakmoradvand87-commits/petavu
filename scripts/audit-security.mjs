#!/usr/bin/env node
/**
 * ماتریس مجوز و اسکیمای امنیت — تولیدشده از خود پایگاه‌داده (§142، §103).
 *
 * چرا تولید و نه نوشتن دستی: ماتریس مجوز اگر دستی نوشته شود، اولین تغییرِ
 * نقش‌ها آن را به سند دروغ تبدیل می‌کند. اینجا پایگاه‌داده از صفر ساخته می‌شود،
 * مهاجرت و seed اجرا می‌شود، و آن‌چه واقعاً برقرار است استخراج و مکتوب می‌شود.
 *
 * خروجی: `docs/security/permission-matrix.md`
 * استفاده: `npm run audit:security`
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './lib/engine.mjs';
import { migrate } from './lib/migrate.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMAS = ['ref', 'auth', 'app', 'media', 'design', 'seo', 'ops'];

const engine = await openDatabase();
await migrate(engine, { dir: join(projectRoot, 'migrations') });
for (const file of ['0001_reference.sql']) {
  await engine.exec(await readFile(join(projectRoot, 'seeds', file), 'utf8'));
}

const rows = async (sql, params) => engine.query(sql, params);

const businessRoles = await rows(`select id, key, name_fa, rank from app.role where business_id is null order by rank`);
const platformRoles = await rows(`select key, name_fa, rank from auth.platform_role order by rank`);
const permissions = await rows(`select key, name_fa, category, is_sensitive from auth.permission order by category, key`);

const businessGrants = new Map();
for (const row of await rows(`select role_id, permission_key from app.role_permission`)) {
  businessGrants.set(`${String(row.role_id)}|${String(row.permission_key)}`, true);
}
const platformGrants = new Set(
  (await rows(`select role_key, permission_key from auth.platform_role_permission`)).map(
    (row) => `${String(row.role_key)}|${String(row.permission_key)}`,
  ),
);

const tables = await rows(`
  select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname = any ($1::text[])
  order by 1, 2
`, [SCHEMAS]);

const policies = await rows(`
  select schemaname, tablename, policyname, cmd, roles::text as roles
  from pg_policies where schemaname = any ($1::text[])
  order by 1, 2, 3
`, [SCHEMAS]);

const policyCount = new Map();
for (const policy of policies) {
  const key = `${policy.schema_name ?? policy.schemaname}.${policy.tablename}`;
  policyCount.set(key, (policyCount.get(key) ?? 0) + 1);
}

const lines = [];
lines.push('# ماتریس مجوز و اسکیمای امنیت');
lines.push('');
lines.push('این پرونده **تولیدشده** است (`npm run audit:security`). منبع حقیقت، پایگاه‌داده است؛');
lines.push('ویرایش دستی این پرونده بی‌اثر است و در اجرای بعدی بازنویسی می‌شود (§103).');
lines.push('');
lines.push(`- زمان تولید (UTC): ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
lines.push(`- جدول‌های دامنه: ${tables.length} — همه با RLS فعال: ${tables.every((t) => t.rls) ? 'بله' : 'نه'}`);
lines.push(`- سیاست‌ها: ${policies.length}`);
lines.push(`- مجوزها: ${permissions.length} — دامنه‌ای: ${permissions.filter((p) => p.category !== 'platform').length}، پلتفرمی: ${permissions.filter((p) => p.category === 'platform').length}`);
lines.push('');

lines.push('## نقش‌های کسب‌وکار');
lines.push('');
lines.push('| نقش | نام | رتبه | شمار مجوز |');
lines.push('| --- | --- | --- | --- |');
for (const role of businessRoles) {
  const count = permissions.filter((p) => businessGrants.has(`${String(role.id)}|${String(p.key)}`)).length;
  lines.push(`| \`${role.key}\` | ${role.name_fa} | ${role.rank} | ${count} |`);
}
lines.push('');

lines.push('## نقش‌های پلتفرم');
lines.push('');
lines.push('| نقش | نام | رتبه | شمار مجوز |');
lines.push('| --- | --- | --- | --- |');
for (const role of platformRoles) {
  const count = permissions.filter((p) => platformGrants.has(`${String(role.key)}|${String(p.key)}`)).length;
  lines.push(`| \`${role.key}\` | ${role.name_fa} | ${role.rank} | ${count} |`);
}
lines.push('');

lines.push('## ماتریس مجوز × نقش');
lines.push('');
lines.push('`●` = دارد، `—` = ندارد. ستون «حساس» یعنی مجوز نیازمند احراز مجدد/تأیید صریح است.');
lines.push('');
const businessHeader = businessRoles.map((role) => role.key).join(' | ');
lines.push(`| مجوز | دسته | حساس | ${businessHeader} | ${platformRoles.map((r) => r.key).join(' | ')} |`);
lines.push(
  `| --- | --- | --- | ${businessRoles.map(() => '---').join(' | ')} | ${platformRoles.map(() => '---').join(' | ')} |`,
);
for (const permission of permissions) {
  const businessCells = businessRoles
    .map((role) => (businessGrants.has(`${String(role.id)}|${String(permission.key)}`) ? '●' : '—'))
    .join(' | ');
  const platformCells = platformRoles
    .map((role) => (platformGrants.has(`${String(role.key)}|${String(permission.key)}`) ? '●' : '—'))
    .join(' | ');
  lines.push(
    `| \`${permission.key}\` | ${permission.category} | ${permission.is_sensitive ? 'بله' : '—'} | ${businessCells} | ${platformCells} |`,
  );
}
lines.push('');

lines.push('## جدول‌ها، RLS و سیاست‌ها');
lines.push('');
lines.push('| جدول | RLS | شمار سیاست |');
lines.push('| --- | --- | --- |');
for (const table of tables) {
  const key = `${table.schema_name}.${table.table_name}`;
  lines.push(`| \`${key}\` | ${table.rls ? 'روشن' : '**خاموش**'} | ${policyCount.get(key) ?? 0} |`);
}
lines.push('');

lines.push('## سیاست‌ها به تفکیک جدول');
lines.push('');
lines.push('| جدول | سیاست | دستور | نقش‌ها |');
lines.push('| --- | --- | --- | --- |');
for (const policy of policies) {
  const target = `${policy.schemaname}.${policy.tablename}`;
  const roles = String(policy.roles).replace(/[{}]/g, '').split(',').join(', ');
  lines.push(`| \`${target}\` | \`${policy.policyname}\` | ${policy.cmd} | ${roles} |`);
}
lines.push('');

const report = lines.join('\n');
const output = join(projectRoot, 'docs', 'security', 'permission-matrix.md');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, report, 'utf8');
await engine.close();

console.log(`نوشته شد: docs/security/permission-matrix.md`);
console.log(
  `  ${tables.length} جدول، ${policies.length} سیاست، ${permissions.length} مجوز، ` +
    `${businessRoles.length} نقش کسب‌وکار، ${platformRoles.length} نقش پلتفرم`,
);
