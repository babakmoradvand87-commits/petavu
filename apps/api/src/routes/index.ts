/**
 * فهرست مسیرها (گام ۲۱؛ §64، §103).
 *
 * این فهرست، **منبع حقیقت** سه چیز است: مسیریاب، سند OpenAPI، و آزمون پوشش.
 * اگر مسیری در اینجا نباشد، وجود ندارد؛ و اگر باشد، در هر سه جا هست. این
 * همان چیزی است که §103 می‌خواهد: قرارداد API، یک جا تعریف شود.
 */

import type { RouteDefinition } from '../types.js';
import { adminRoutes } from './admin.js';
import { authRoutes } from './auth.js';
import { automationRoutes } from './automation.js';
import { businessRoutes } from './businesses.js';
import { catalogRoutes } from './catalog.js';
import { contentRoutes } from './content.js';
import { designRoutes } from './design.js';
import { healthRoutes } from './health.js';
import { opsRoutes } from './ops.js';
import { panelRoutes } from './panel.js';
import { performanceRoutes } from './performance.js';
import {shopRoutes} from './shop.js';
import {discoveryRoutes} from './discovery.js';
import {nocodeRoutes} from './nocode.js';
import { studioRoutes } from './studio.js';
import { seoRoutes } from './seo.js';

export const API_PREFIX = '/api/v1';

export const routes: readonly RouteDefinition[] = [
  ...healthRoutes,
  ...adminRoutes,
  ...authRoutes,
  ...businessRoutes,
  ...contentRoutes,
  ...designRoutes,
  ...seoRoutes,
  ...automationRoutes,
  ...performanceRoutes,
  ...catalogRoutes,
  ...opsRoutes,
  ...panelRoutes,
  ...studioRoutes,
  ...nocodeRoutes,
  ...discoveryRoutes,
  ...shopRoutes,
];

export {
  authRoutes,
  automationRoutes,
  businessRoutes,
  catalogRoutes,
  contentRoutes,
  designRoutes,
  healthRoutes,
  opsRoutes,
  panelRoutes,
  performanceRoutes,
  seoRoutes,
};
