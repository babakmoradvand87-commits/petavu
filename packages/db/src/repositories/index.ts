/**
 * Repositoryها (گام ۱۹؛ §52–۵۵، §93؛ Addendum §20، §102).
 *
 * قاعدهٔ ساخت: هر Repository یک **کارخانه** است که `RepoDeps` می‌گیرد و شیء
 * می‌سازد. چرا کارخانه و نه کلاس سراسری:
 *
 *   • سالم‌بودن بسته به زمینه: `createRepositories({ dal: createDal(tx), context })`
 *     را می‌توان دور هر تراکنش ساخت، بی‌آنکه چیزی سراسری شود (ADR-0010).
 *   • تست‌پذیری: هیچ اتصال سراسری، هیچ حالت پنهان.
 *   • مرز امنیتی روشن: هر متد، مجوز و مستأجر را از همان `context` می‌گیرد.
 *
 * آنچه اینجا **نیست**: هیچ منطق دامنه‌ای که در SQL هست، دوباره نوشته نمی‌شود.
 * گذر وضعیت، انتقال مالکیت، پذیرش دعوت، ثبت رخداد، و دروازهٔ انتشار همه تابع
 * دامنه‌اند؛ Repository فقط آن‌ها را صدا می‌زند.
 */

import type { Dal } from '../dal.js';
import type { RequestContext } from '../context.js';
import { businessRepository } from './business.js';
import { identityRepository } from './identity.js';
import { contentRepository } from './content.js';
import { catalogRepository } from './catalog.js';
import { designRepository } from './design.js';
import { seoRepository } from './seo.js';
import { opsRepository } from './ops.js';
import { automationRepository } from './automation.js';
import { performanceRepository } from './performance.js';

export interface CreateRepositoriesOptions {
  dal: Dal;
  context: RequestContext;
}

export function createRepositories(options: CreateRepositoriesOptions) {
  const deps = { dal: options.dal, context: options.context };

  return {
    identity: identityRepository(deps),
    business: businessRepository(deps),
    content: contentRepository(deps),
    catalog: catalogRepository(deps),
    design: designRepository(deps),
    seo: seoRepository(deps),
    ops: opsRepository(deps),
    automation: automationRepository(deps),
    performance: performanceRepository(deps),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

export * from './support.js';
export { businessRepository } from './business.js';
export { identityRepository } from './identity.js';
export { contentRepository } from './content.js';
export { catalogRepository } from './catalog.js';
export { designRepository } from './design.js';
export { seoRepository } from './seo.js';
export { opsRepository } from './ops.js';
export { automationRepository, AUTOMATION_ACTIONS, CONDITION_OPERATORS } from './automation.js';
export { performanceRepository } from './performance.js';
