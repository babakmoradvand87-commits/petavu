/**
 * آداپتور موتور تعبیه‌شده به قرارداد `SqlClient` (مشترک: آزمون‌ها و ابزارهای CLI).
 *
 * `SqlClient` همان چیزی است که لایهٔ `@petavu/db` از یک درایور می‌خواهد؛ موتور
 * تعبیه‌شده و PostgreSQL واقعی هر دو پشت همین قرارداد می‌نشینند. پیش‌تر این تابع
 * در هر پروندهٔ آزمون کپی می‌شد (۱۵ نسخه)؛ حالا یک جاست.
 */
export function createEmbeddedClient(handle) {
  const make = (runner) => {
    const scoped = {
      engine: 'embedded',
      async query(text, params = []) {
        const rows = await runner.query(text, params);
        return { rows, affected: rows.length };
      },
      async exec(text) {
        await runner.exec(text);
      },
      withTransaction: (fn) =>
        typeof runner.withTransaction === 'function' ? runner.withTransaction(async (tx) => fn(make(tx))) : fn(scoped),
      async asRole(role, fn) {
        await runner.exec(`set role "${role}"`);
        try {
          return await fn(scoped);
        } finally {
          await runner.exec('reset role').catch(() => {});
        }
      },
      close: () => handle.close(),
    };
    return scoped;
  };
  return make(handle);
}
