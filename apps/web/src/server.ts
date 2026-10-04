/**
 * سرور وب (گام ۲۲؛ §64–۷۸، §93–۹۹، Addendum §۹–۱۲).
 *
 * «بدون فریم‌ورک» این‌جا فقط سادگی نیست؛ چهار چیز باید در دست خودمان باشد چون
 * هر کدام یا یک عدد قابل اندازه‌گیری است یا یک مرز امنیتی:
 *
 *   • **هدرها.** CSP سخت، `nosniff`، `frame-ancestors 'none'`، HSTS فقط در
 *     تولید. با فریم‌ورک این‌ها «افزونه» می‌شوند؛ این‌جا، پیش‌فرض.
 *   • **کش.** دارایی درهم‌دار ⇒ `immutable`؛ HTML ⇒ `must-revalidate` + ETag؛
 *     پاسخ خطا ⇒ `no-store`.
 *   • **فشرده‌سازی.** brotli اگر مرورگر بپذیرد، وگرنه gzip، وگرنه خام — با
 *     آستانهٔ ۱ کیلوبایت، چون فشرده‌کردن پاسخ کوچک کار بیهوده است.
 *   • **زمان.** `headersTimeout`/`requestTimeout` بسته می‌شوند تا یک اتصال کند
 *     نتواند ظرفیت سرور را ببلعد.
 *
 * ترتیب پردازش یک درخواست، ثابت و بدون گام پنهان است:
 *   متد ⇒ رمزگشایی مسیر ⇒ میزبان ⇒ ریدایرکت (اسلش/قاعدهٔ داده) ⇒ مسیر ⇒
 *   پاسخ ⇒ ETag/۳۰۴ ⇒ فشرده‌سازی ⇒ لاگ.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { brotliCompressSync, gzipSync } from 'node:zlib';

import type { SqlClient } from '@petavu/db';
import { AppError, createLogger, type Env, type Logger } from '@petavu/shared';

import { createAssetRegistry, type AssetRegistry, type AssetEntry } from './assets.js';
import { PLATFORM_NAME } from './chrome.js';
import { createWebConfig, resolveSite, type SitePolicy, type WebConfig } from './config.js';
import { createWebData, type WebData } from './data.js';
import { createFontSetup, type FontSetup } from './fonts.js';
import { buildTheme, type ThemeBundle } from './theme.js';
import { SHELL_CSS } from './styles.js';
import { canonicalRedirect, decodePath, resolveTarget } from './router.js';
import { createRegistryCache, type ComponentRegistry } from './registry.js';
import { mediaHeaders, readLocalMedia, resolveAssetSource, type MediaAssetRow } from './media.js';
import {
  createDiskVariantCache,
  createLimiter,
  createPicture,
  loadImageEngine,
  parseImageConfig,
  parseVariantQuery,
  variantKey,
  versionOf,
  type EngineStatus,
  type ImageEngine,
  type ImagePicture,
  type ImagePipelineConfig,
} from './imagepipeline.js';
import { notModifiedHeaders, securityHeaders } from './headers.js';
import { createApiClient } from './panel/api.js';
import { createPanel } from './panel/core.js';
import { MAX_FORM_BYTES } from './panel/forms.js';
import { ADMIN_SECTIONS } from './panel/admin.js';
import { MEMBER_SECTIONS } from './panel/sections.js';
import { PROXY_RULES, forwardToApi, matchProxyRule } from './proxy.js';
import { businessPage } from './pages/business.js';
import { businessesPage } from './pages/businesses.js';
import { llmsPage, robotsPage, sitemapPage, sitemapPartPage } from './pages/feeds.js';
import { homePage } from './pages/home.js';
import { indexNowStatus } from './indexnow.js';
import { publicDesignPage } from './pages/design.js';
import {renderShell} from './chrome.js';
import {buildHead} from '@petavu/seo';
import {parseForm} from './panel/forms.js';
import {escapeText,tag} from './html.js';
import { platformContentPage } from './pages/content.js';
import { textPageResponse } from './chrome.js';
import { searchPage } from './pages/search.js';
import { businessTypePage, categoryPage, industryPage, locationPage, taxonomyIndexPage } from './pages/taxonomy.js';
import { gonePage, healthResponse, notFoundPage, readinessResponse } from './pages/system.js';
import type { PageContext, PageResponse } from './pages/types.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;
const COMPRESS_THRESHOLD = 1024;
const ALLOWED_METHODS = 'GET, HEAD';
const CSS_ASSET = 'app.css';

export interface WebServerOptions {
  readonly client: SqlClient;
  readonly env: Env;
  readonly logger?: Logger;
  /** پوشهٔ دارایی‌ها؛ پیش‌فرض `apps/web/assets`. */
  readonly assetsDirectory: string;
  /** ساعت تزریق‌شده — تست‌ها با آن زمان ثابت می‌سازند. */
  readonly now?: () => Date;
  /**
   * مبدأ داخلی API برای رلهٔ فهرست‌سفید (`proxy.ts`). پیش‌فرض: `API_PORT` روی میزبان
   * پیکربندی‌شده. در استقرار با پروکسی، این رله استفاده نمی‌شود.
   */
  readonly apiOrigin?: string;
  /** پوشهٔ نسخه‌های تصویر (AVIF/WebP). پیش‌فرض: کنار `STORAGE_LOCAL_DIR`، با پسوند `.variants`. */
  readonly variantsDirectory?: string;
  /** عمر کش تنظیمات خط لولهٔ تصویر (میلی‌ثانیه)؛ آزمون‌ها صفر می‌دهند. پیش‌فرض ۶۰ ثانیه. */
  readonly imageConfigTtlMs?: number;
  /**
   * موتور تبدیل تصویر تزریق‌شده. پیش‌فرض: بارگذاری پویای `sharp`. تزریق، درز آزمون است (سنجش
   * «موتور نیست» و شمردن تبدیل‌ها)، نه جایگزین موتور واقعی.
   */
  readonly imageEngine?: ImageEngine;
}

export interface RenderRequest {
  readonly method: string;
  readonly url: string;
  readonly host: string;
  readonly headers?: Record<string, string | undefined>;
  readonly body?: string;
  readonly ip?: string;
}

export interface RenderResult {
  readonly status: number;
  readonly headers: Record<string, string>;
  /** بدنهٔ **رمزگشایی‌نشده**؛ فشرده‌سازی، کار لایهٔ شبکه است. */
  readonly body: string;
  /**
   * بدنهٔ دودویی (رسانه). اگر حاضر باشد، **به‌جای** `body` فرستاده می‌شود.
   *
   * چرا جدا: عبور فایل دودویی از `body` یعنی یک رفت‌وبرگشت UTF-8 که بایت‌ها
   * را خراب می‌کند. جدایی این دو مسیر، جلوی همان خرابی را می‌گیرد.
   */
  readonly bytes?: Buffer;
  readonly cookies?: readonly string[];
}

export interface WebServer {
  readonly server: Server;
  readonly config: WebConfig;
  readonly assets: AssetRegistry;
  readonly fonts: FontSetup;
  /** Registry کامپوننت‌ها همان‌طور که سرور می‌بیند — برای آزمون و بازرسی. */
  componentRegistry(): Promise<ComponentRegistry>;
  listen(port: number, host?: string): Promise<{ port: number }>;
  close(): Promise<void>;
  /** رندر یک درخواست بدون سوکت — برای تست و پیش‌گرم. */
  render(request: RenderRequest): Promise<RenderResult>;
  /** CSS نهایی (توکن‌ها + فونت + پوسته). پیش از اولین درخواست ساخته می‌شود. */
  stylesheet(): Promise<string>;
  /** وضعیت صریح موتور تصویر (PART 102): `configured` یا `not_configured` با دلیل. */
  imagePipelineStatus(): Promise<EngineStatus>;
  /** تحلیل نهایی سهم بایت‌های بحرانی — پایهٔ سنجش بودجهٔ عملکرد. */
  budgetSnapshot(): Promise<{ cssBytes: number; fontBytes: number; documents: number }>;
}

export function createWebServer(options: WebServerOptions): WebServer {
  const logger = options.logger ?? createLogger({ level: options.env.logLevel });
  const now = options.now ?? (() => new Date());
  const config = createWebConfig(options.env, { assetsDirectory: options.assetsDirectory });
  const data: WebData = createWebData({ client: options.client, logger });

  /*
   * Registry کامپوننت‌ها با عمر محدود کش می‌شود: در هر رندر لازم است و خواندنش
   * در هر درخواست، یک رفت‌وبرگشت اضافه به پایگاه‌داده است.
   */
  const registryCache = createRegistryCache({
    load: () => data.componentRegistry('registry-cache'),
    onError: (error) =>
      logger.warn('خواندن Registry کامپوننت‌ها شکست خورد؛ Registry پیشین نگه داشته شد', {
        error: error instanceof Error ? error.message : String(error),
      }),
  });
  const assets = createAssetRegistry({ directory: options.assetsDirectory });
  const apiOrigin =
    options.apiOrigin ??
    `http://${['0.0.0.0', '::', ''].includes(options.env.http.host) ? '127.0.0.1' : options.env.http.host}:${options.env.apiPort}`;

  /*
   * خط لولهٔ تصویر. موتور (sharp) یک‌بار و تنبل بارگذاری می‌شود؛ نبودش سایت را نمی‌شکند.
   * تنظیمات از `platform.image_pipeline` (داده) با عمر کوتاه کش می‌شود.
   */
  const variantCache = createDiskVariantCache(
    options.variantsDirectory ?? `${options.env.storage.localDir.replace(/[\\/]+$/, '')}.variants`,
  );
  const limitTranscode = createLimiter(2);
  const inflightVariants = new Map<string, Promise<Buffer>>();
  let enginePromise: Promise<ImageEngine> | null = null;
  const getEngine = (): Promise<ImageEngine> => (enginePromise ??= options.imageEngine ? Promise.resolve(options.imageEngine) : loadImageEngine(logger));
  let imageState: { config: ImagePipelineConfig; picture: ImagePicture; engine: ImageEngine; at: number } | null = null;

  async function getImages(): Promise<{ config: ImagePipelineConfig; picture: ImagePicture; engine: ImageEngine }> {
    const ttl = options.imageConfigTtlMs ?? 60_000;
    if (imageState && Date.now() - imageState.at < ttl) return imageState;
    const engine = await getEngine();
    const config = parseImageConfig(await data.platformSetting('platform.image_pipeline', 'image-config'));
    imageState = { config, engine, picture: createPicture(config, engine), at: Date.now() };
    return imageState;
  }

  const fonts = createFontSetup({
    assetsDirectory: options.assetsDirectory,
    assets,
    publicOrigin: options.env.origins.public,
  });

  function cssFor(theme: ThemeBundle): string {
    return [theme.css, fonts.faceCss, SHELL_CSS].join('\n\n');
  }

  /*
   * تم، داده‌ای کم‌تغییر است: یک بار خوانده می‌شود، در حافظه می‌ماند و CSS از
   * آن ساخته می‌شود. اما **بی‌قید و شرط تازه نمی‌شود**؛ تازه‌سازی، از رخداد
   * `design.token` در گام‌های بعد می‌آید (Addendum §۹: کش چندلایه).
   */
  let themePromise: Promise<ThemeBundle> | null = null;
  let cssPromise: Promise<AssetEntry> | null = null;

  let themeKey = '';
  const getTheme = async (): Promise<ThemeBundle> => { const key = await data.themeFingerprint('theme-fingerprint'); if (key !== themeKey) { themeKey=key; themePromise=null; cssPromise=null; } return themePromise ??= loadTheme(); };

  async function loadTheme(): Promise<ThemeBundle> {
    return buildTheme(await awaitTokens(),await data.themeSettings('bootstrap'));
  }

  async function awaitTokens(): Promise<Parameters<typeof buildTheme>[0]> {
    return data.themeTokens('bootstrap');
  }

  const getCssAsset = async (): Promise<AssetEntry> => { const theme = await getTheme(); return cssPromise ??= Promise.resolve(assets.registerGenerated(CSS_ASSET, cssFor(theme), 'text/css; charset=utf-8')); };

  /** راه‌اندازی گرم: تم، CSS و Registry — پیش از شنیدن روی پورت. */
  async function warmup(): Promise<void> {
    await getCssAsset();
    await registryCache.get();
    await getEngine();
  }

  async function buildContext(input: {
    url: URL;
    host: string;
    requestId: string;
    site: SitePolicy;
    theme: ThemeBundle;
  }): Promise<PageContext> {
    const [settings, pages, stats, featured, contents, registry, rumSampleRate, images] = await Promise.all([
      data.seoSettings(input.requestId),
      data.platformPages(input.requestId),
      data.platformStats(input.requestId),
      data.featuredBusinesses(6, input.requestId),
      data.contentIndex(4, input.requestId),
      registryCache.get(),
      // نرخ نمونه‌گیری سنجش میدانی، از بودجهٔ همین مسیر (داده، نه ثابت کد): مسیرِ بی‌بودجه ⇒ ۰.
      input.site.kind === 'public' ? data.rumSampleRate(input.url.pathname, input.requestId) : Promise.resolve(0),
      getImages(),
    ]);

    return {
      config,
      site: input.site,
      url: input.url,
      requestId: input.requestId,
      data,
      assets,
      fonts,
      theme: input.theme,
      settings,
      siteName: PLATFORM_NAME,
      now: now(),
      chrome: { pages, stats, featured, contents, rumSampleRate },
      registry,
      images: images.picture,
      logger,
    };
  }

  async function dispatch(input: {
    url: URL;
    host: string;
    requestId: string;
  }): Promise<RenderResult> {
    const decodedPath = decodePath(input.url.pathname);

    if (decodedPath === null) {
      return plain(400, 'bad request', input.requestId);
    }

    const site = resolveSite(config, input.host);
    if (!site) {
      /*
       * میزبان ناشناس: نه صفحه، نه ریدایرکت. ریدایرکت، `Host` را بازتاب
       * می‌دهد و بازتاب `Host` خودش یک آسیب‌پذیری کلاسیک است.
       */
      return plain(421, 'misdirected request', input.requestId);
    }

    // یک نشانی، یک صفحه: مسیر با اسلش پایانی، به شکل بدون اسلش می‌رود.
    const canonical = canonicalRedirect(decodedPath);
    if (canonical) {
      return redirect(308, `${canonical}${input.url.search}`, input.requestId);
    }

    // قواعد تغییر مسیر داده‌محور (Addendum §۴۵)، پیش از مسیریابی.
    const rule = await data.redirectFor(decodedPath, input.requestId);
    if (rule) {
      if (rule.status_code === 410) {
        const theme = await getTheme();
        const context = await buildContext({ ...input, site, theme });
        return finalize(gonePage(context, { reason: 'redirect_410' }), input.requestId);
      }
      return redirect(rule.status_code, rule.target_path ?? '/', input.requestId);
    }

    const target = resolveTarget(decodedPath, site.kind);

    if (target.type === 'asset') {
      const entry = assets.resolve(`/assets/${target.path}`);
      // دارایی ناموجود: پاسخ متنی ساده، بدون رندر صفحه (این درخواست‌ها ماشینی‌اند).
      if (!entry) return plain(404, 'asset not found', input.requestId);
      /*
       * بایت‌ها، نه رشته. نسخهٔ نخست `assets.body(entry).toString('utf8')` می‌داد؛ برای CSS و
       * SVG بی‌اثر بود، ولی **فونت woff2 را خراب می‌کرد**: بایت‌های نامعتبر UTF-8 با U+FFFD
       * (سه بایت) جایگزین می‌شدند و فایلِ ۸۳٬۰۴۸ بایتی، ۱۵۰٬۶۱۰ بایتِ ناهمسان می‌رسید.
       * مرورگر چنین فونتی را رد می‌کند و سایت بی‌صدا با فونت جایگزین دیده می‌شد — همان چیزی که
       * «اندازه‌گیری بایتِ سروشده» می‌گیرد و «اندازهٔ فایل روی دیسک» نمی‌گیرد.
       */
      return {
        status: 200,
        headers: {
          ...securityHeaders({ env: options.env, kind: 'asset', cdnCacheable: true, requestId: input.requestId }),
          'content-type': entry.contentType,
          etag: `"${entry.hash}"`,
        },
        body: '',
        bytes: assets.body(entry),
      };
    }

    if (target.type === 'media') {
      return mediaResponse(target.id, input.requestId, input.url.searchParams);
    }

    /*
     * CSS باید **پیش از** رندر ثبت شده باشد: صفحه‌ها نشانی دارایی را از
     * رجیستری می‌پرسند. ثبت، یک‌بار انجام می‌شود (memoized) و اگر نشود،
     * «دارایی ناشناخته» می‌گیریم — همان خطایی که در آزمون اول دیدیم.
     */
    await getCssAsset();

    const theme = await getTheme();
    const context = await buildContext({ ...input, site, theme });

    switch (target.type) {
      case 'health':
        return finalize(healthResponse(), input.requestId);
      case 'ready':
        return finalize(await readinessResponse(context), input.requestId);
      case 'robots':
        return finalize(await robotsPage(context, { indexingEnabled: await data.indexingEnabled(input.requestId) }), input.requestId);
      case 'llms':
        return finalize(await llmsPage(context), input.requestId);
      case 'sitemap':
        return finalize(await sitemapPage(context), input.requestId);
      case 'indexnow_key': {
        /*
         * فایل مالکیت IndexNow. فقط وقتی کلید در تنظیمات هست، معتبر است و **با همین
         * مسیر برابر** است، ۲۰۰ می‌شود. هر حالت دیگر همان ۴۰۴ همیشگی است — وجود یا
         * نبودِ تنظیم، اوراکل نمی‌سازد.
         */
        const status = indexNowStatus(await data.platformSetting('seo.indexnow', input.requestId));
        if (status.status === 'configured' && status.key === target.key) {
          return finalize(textPageResponse(200, 'text', status.key), input.requestId);
        }
        return finalize(notFoundPage(context, { reason: 'route:indexnow_key' }), input.requestId);
      }
      case 'sitemap_part': {
        const part = await sitemapPartPage(context, target.ref);
        // بخشِ ناموجود (بیرون از بازه یا بی‌عضو): پاسخ ماشینیِ ساده، نه صفحهٔ ۴۰۴ HTML.
        return part ? finalize(part, input.requestId) : plain(404, 'sitemap not found', input.requestId);
      }
      case 'home':
        return finalize(await homePage(context), input.requestId);
      case 'businesses':
        return finalize(await businessesPage(context), input.requestId);
      case 'business': {
        const found=await data.businessBySlug(target.slug,input.requestId);
        const businessTheme=found?buildTheme(await data.themeTokens(input.requestId,found.business.id),await data.themeSettings(input.requestId,found.business.id)):context.theme;
        const stylesheet=assets.registerGenerated(`business-${found?.business.id??'not-found'}.css`,cssFor(businessTheme),'text/css; charset=utf-8');
        return finalize(await businessPage({...context,theme:businessTheme,stylesheetUrl:stylesheet.url}, target.slug), input.requestId);
      }
      case 'design_page': return finalize(await publicDesignPage(context,target.key,target.businessSlug??null),input.requestId);
      case 'search':
        return finalize(await searchPage(context), input.requestId);
      case 'taxonomy_index':
        return finalize(await taxonomyIndexPage(context, target.family), input.requestId);
      case 'business_type':
        return finalize(await businessTypePage(context, target.key), input.requestId);
      case 'industry':
        return finalize(await industryPage(context, target.path), input.requestId);
      case 'location':
        return finalize(await locationPage(context, target.suffix), input.requestId);
      case 'category':
        return finalize(await categoryPage(context, target.path), input.requestId);
      case 'business_content': {const b=await data.businessBySlug(target.businessSlug,input.requestId);return finalize(b?await platformContentPage(context,target.slug,b.business.id):notFoundPage(context,{reason:'content_scope'}),input.requestId);}
      case 'content':
        if (await data.designPage({businessId:null,key:target.slug},input.requestId)) return finalize(await publicDesignPage(context,target.slug,null),input.requestId);
        return finalize(await platformContentPage(context, target.slug), input.requestId);
      case 'forbidden':
      case 'method_not_allowed':
      case 'not_found':
      default:
        /*
         * سه حالت، یک پاسخ.
         *
         * تفکیک «هست ولی اجازه نداری» از «نیست» یک اوراکل می‌سازد؛ و سطح
         * مدیریتی روی میزبان عمومی نباید حتی وجودش لو برود. پس همه‌جا ۴۰۴.
         */
        return finalize(notFoundPage(context, { reason: `route:${target.type}` }), input.requestId);
    }
  }

  /**
   * پاسخ رسانه.
   *
   * سه مسیر، یک قاعده: **هیچ‌وقت ۵۰۰**. دارایی نامعتبر یا نبودِ فایل ⇒ ۴۰۴
   * یکنواخت. تفکیک «نیست» از «هست ولی خصوصی است» یک اوراکل می‌سازد و RLS هم
   * همین را تضمین می‌کند: بی‌نام فقط دارایی `is_public` و `ready` را می‌بیند.
   */
  async function mediaResponse(id: string, requestId: string, query: URLSearchParams): Promise<RenderResult> {
    const asset = (await data.mediaAsset(id, requestId)) as MediaAssetRow | null;
    if (!asset) return plain(404, 'media not found', requestId);

    const source = resolveAssetSource(asset);
    if (!source) {
      logger.warn('نشانی رسانه ساخته نشد؛ دارایی بی‌نشانی است', { requestId, assetId: asset.id, driver: asset.driver });
      return plain(404, 'media not found', requestId);
    }

    // نسخهٔ AVIF/WebP؟ پارامترها سخت‌گیرانه سنجیده می‌شوند؛ «تقریباً درست» وجود ندارد.
    const images = await getImages();
    const variant = parseVariantQuery(query, { width: asset.width, version: versionOf(asset.checksum_sha256) }, images.config);
    if (variant === 'invalid') return plain(404, 'media not found', requestId);
    if (variant) return variantResponse(asset, variant.width, variant.format, images, requestId);

    // دارایی بیرونی: هدایت. فایل دست ما نیست و نباید از دامنهٔ ما سرو شود.
    if (source.redirect) return redirect(302, source.url, requestId);

    const file = await readLocalMedia(options.env.storage.localDir, asset.storage_key, {
      contentType: asset.detected_mime,
    });

    if (!file) {
      logger.warn('فایل رسانه در انبار پیدا نشد', { requestId, assetId: asset.id, driver: asset.driver });
      return plain(404, 'media not found', requestId);
    }

    const etag = `"${asset.checksum_sha256 ?? `bytes-${file.sizeBytes}`}"`;

    return {
      status: 200,
      headers: {
        ...securityHeaders({ env: options.env, kind: 'asset', cdnCacheable: true, requestId }),
        ...mediaHeaders({
          sizeBytes: file.sizeBytes,
          contentType: file.contentType,
          disposition: file.disposition,
          etag,
          fileName: asset.original_name,
        }),
      },
      body: '',
      bytes: file.body,
    };
  }

  /**
   * نسخهٔ AVIF/WebP یک تصویر. هر ناکامی (موتور نیست، فایل نیست، رمزگشایی نشد) همان ۴۰۴ یکنواخت
   * است؛ علت فقط در لاگ می‌رود. تبدیل هم‌زمان برای یک کلید یک‌بار انجام می‌شود (`inflight`)،
   * و کل تبدیل‌ها سقف دارند (پردازنده منبع محدود است).
   */
  async function variantResponse(
    asset: MediaAssetRow,
    width: number,
    format: 'avif' | 'webp',
    images: { config: ImagePipelineConfig; engine: ImageEngine },
    requestId: string,
  ): Promise<RenderResult> {
    const eligible =
      images.engine.status().status === 'configured' &&
      asset.driver === 'local' &&
      asset.kind === 'image' &&
      images.config.acceptedMime.includes(asset.detected_mime) &&
      typeof asset.checksum_sha256 === 'string';
    if (!eligible) return plain(404, 'media not found', requestId);

    const key = variantKey(asset.checksum_sha256 as string, width, format, images.config.quality[format]);
    try {
      let bytes = await variantCache.get(key, format);
      if (!bytes) {
        let pending = inflightVariants.get(key);
        if (!pending) {
          pending = limitTranscode(async () => {
            const file = await readLocalMedia(options.env.storage.localDir, asset.storage_key, {
              contentType: asset.detected_mime,
              maxBytes: images.config.maxBytes,
            });
            if (!file) throw new Error('فایل اصلی در انبار نیست');
            const out = await images.engine.transcode(file.body, {
              width,
              format,
              quality: images.config.quality[format],
              maxPixels: images.config.maxPixels,
            });
            await variantCache.put(key, format, out);
            return out;
          }).finally(() => inflightVariants.delete(key));
          inflightVariants.set(key, pending);
        }
        bytes = await pending;
      }

      const stem = (asset.original_name ?? 'image').replace(/\.[^.]+$/, '');
      return {
        status: 200,
        headers: {
          ...securityHeaders({ env: options.env, kind: 'asset', cdnCacheable: true, requestId }),
          ...mediaHeaders({
            sizeBytes: bytes.byteLength,
            contentType: `image/${format}`,
            disposition: 'inline',
            // `v` در نشانی است و کلید، درهم محتواست؛ پس `immutable` همیشه امن است.
            etag: `"${key}"`,
            fileName: `${stem}.${format}`,
          }),
        },
        body: '',
        bytes,
      };
    } catch (error) {
      logger.warn('نسخهٔ تصویر ساخته نشد', {
        requestId,
        assetId: asset.id,
        width,
        format,
        error: error instanceof Error ? error.message.slice(0, 200) : String(error),
      });
      return plain(404, 'media not found', requestId);
    }
  }

  function finalize(response: PageResponse, requestId: string): RenderResult {
    const headers: Record<string, string> = {
      ...securityHeaders({
        env: options.env,
        kind: response.kind,
        cdnCacheable: response.cacheable !== false && response.kind !== 'html',
        requestId,
        cacheable: response.cacheable,
      }),
      ...(response.headers ?? {}),
    };

    if (!headers['content-type']) headers['content-type'] = contentTypeFor(response.kind);
    if (!headers['x-request-id']) headers['x-request-id'] = requestId;

    return { status: response.status, headers, body: response.body };
  }

  function redirect(status: number, location: string, requestId: string): RenderResult {
    return {
      status,
      headers: {
        ...securityHeaders({ env: options.env, kind: 'text', cdnCacheable: false, requestId, cacheable: false }),
        location,
        'content-type': 'text/plain; charset=utf-8',
      },
      body: '',
    };
  }

  function plain(status: number, message: string, requestId: string): RenderResult {
    return {
      status,
      headers: {
        ...securityHeaders({ env: options.env, kind: 'text', cdnCacheable: false, requestId, cacheable: false }),
        'content-type': 'text/plain; charset=utf-8',
      },
      body: `${message}\n`,
    };
  }

  async function render(input: RenderRequest): Promise<RenderResult> {
    const method = input.method.toUpperCase();
    const requestId = pickRequestId(input.headers?.['x-request-id']);

    const site = resolveSite(config, input.host);
    let privatePath: string | null = null;
    try { privatePath = decodePath(new URL(input.url, 'http://placeholder').pathname); } catch { return plain(400, 'bad request', requestId); }
    const formMatch=privatePath? /^\/forms\/(platform|[0-9a-f-]{36})\/([0-9a-f-]{36})$/.exec(privatePath):null;
    if(site?.kind==='public'&&method==='POST'&&formMatch){
      if(input.headers?.origin!==site.origin)return plain(403,'forbidden',requestId);if((input.headers?.['content-type']??'').split(';')[0]!=='application/x-www-form-urlencoded')return plain(415,'unsupported media',requestId);if(Buffer.byteLength(input.body??'')>MAX_FORM_BYTES)return plain(413,'payload too large',requestId);const form=parseForm(input.body??'');if(!form)return plain(400,'invalid form',requestId);const values:Record<string,string>=Object.create(null) as Record<string,string>;for(const[k,v]of Object.entries(form))if(!k.startsWith('_'))values[k]=v;
      const receiver=formMatch[1],id=formMatch[2];const endpoint=receiver==='platform'?`/api/v1/public/forms/${id}/submissions`:`/api/v1/public/businesses/${receiver}/forms/${id}/submissions`;const res=await createApiClient({origin:apiOrigin,logger}).call({method:'POST',path:endpoint,cookie:null,origin:site.origin,ip:input.ip??'127.0.0.1',requestId,body:{values,consent:form['_consent']==='true',schema_hash:form['_schema'],idempotency_key:form['_nonce'],website:form['_website']??''}});
      await getCssAsset();const context=await buildContext({url:new URL(input.url,site.origin),host:input.host,requestId,site,theme:await getTheme()});const ok=res.status===201;const content=tag('section',{class:'section'},tag('h1',{},ok?'درخواست ثبت شد':'درخواست ثبت نشد')+tag('p',{role:ok?'status':'alert'},escapeText(ok?String(res.json?.['success_message']??'درخواست شما ذخیره شد.'):'اطلاعات کامل و معتبر نیست، نسخهٔ فرم تغییر کرده یا سرویس در دسترس نیست.'))+(ok?tag('p',{},'شماره رسید: '+escapeText(String(res.json?.['id']))):'')+tag('a',{class:'button',href:'/'},'بازگشت'));return finalize({status:ok?200:res.status,kind:'html',cacheable:false,body:renderShell({config,site,url:context.url,siteName:context.siteName,headTags:buildHead({url:context.url.href,title:'ثبت درخواست',indexable:false,environment:'preview'}),theme:context.theme,fonts:context.fonts,assets,chrome:context.chrome,now:context.now,content})},requestId);
    }
    const isPanel = site && (site.kind === 'panel' || site.kind === 'admin') && privatePath !== null && !privatePath.startsWith('/api/') && !privatePath.startsWith('/assets/') && !privatePath.startsWith('/media/') && !['/healthz','/readyz'].includes(privatePath);
    if (isPanel && ['GET','HEAD','POST'].includes(method)) {
      if (Buffer.byteLength(input.body ?? '') > MAX_FORM_BYTES) return plain(413, 'payload too large', requestId);
      await getCssAsset();
      const panel = createPanel({ api: createApiClient({ origin: apiOrigin, logger }), config, assets, theme: await getTheme(), logger, sections: { panel: MEMBER_SECTIONS, admin: ADMIN_SECTIONS } });
      const url = new URL(input.url, site.origin);
      const result = await panel.handle({ surface: site.kind as 'panel' | 'admin', method: method === 'POST' ? 'POST' : 'GET', pathname: privatePath as string, search: url.searchParams, cookie: input.headers?.cookie ?? null, origin: input.headers?.origin ?? null, ip: input.ip ?? '127.0.0.1', userAgent: input.headers?.['user-agent'] ?? null, body: input.body ?? null, contentType: input.headers?.['content-type'] ?? null, requestId });
      return { ...result, cookies: result.cookies };
    }
    if (method !== 'GET' && method !== 'HEAD') {
      const result = plain(405, 'method not allowed', requestId);
      return { ...result, headers: { ...result.headers, allow: ALLOWED_METHODS } };
    }

    try {
      const url = new URL(input.url, `http://${input.host || 'unknown'}`);
      return await dispatch({ url, host: input.host, requestId });
    } catch (error) {
      const appError = error instanceof AppError ? error : null;
      logger.error('درخواست وب شکست خورد', {
        requestId,
        url: input.url,
        code: appError?.code ?? 'internal_error',
        error: error instanceof Error ? error.message : String(error),
      });

      /*
       * پاسخ خطا، بی‌جزئیات فنی. `request_id` تنها سرنخ بیرونی است — برای ما
       * کافی است و برای مهاجم بی‌ارزش.
       */
      const status = appError?.status ?? 500;
      const message = status >= 500 ? `internal error (${requestId})` : (appError?.code ?? 'error');
      return plain(status, message, requestId);
    }
  }

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void serveHttp(request, response).catch((error: unknown) => {
      logger.error('پردازش درخواست شکست خورد', { error: error instanceof Error ? error.message : String(error) });
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('internal error\n');
    });
  });

  async function serveHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const started = process.hrtime.bigint();
    const host = request.headers.host ?? '';

    const hasBody =
      (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0') ||
      request.headers['transfer-encoding'] !== undefined;

    /*
     * رلهٔ فهرست‌سفید به API (فقط متدهای تغییردهنده؛ GET/HEAD همیشه از مسیر رندر می‌گذرند).
     * مسیر، میزبان و متد باید **هر سه** با یک قاعدهٔ ثبت‌شده بخوانند؛ وگرنه همان ۴۰۵ همیشگی.
     */
    const method = (request.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      const site = resolveSite(config, host);
      const pathname = decodePath(new URL(request.url ?? '/', 'http://placeholder').pathname);
      const rule = site && pathname ? matchProxyRule(PROXY_RULES, site.kind, method, pathname) : null;
      if (rule) {
        const requestId = pickRequestId(typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : undefined);
        await forwardToApi(request, response, rule, requestId, {
          apiOrigin,
          logger,
          proto: options.env.origins.public.startsWith('https:') ? 'https' : 'http',
          baseHeaders: (id) => securityHeaders({ env: options.env, kind: 'json', cdnCacheable: false, requestId: id, cacheable: false }),
        });
        const record = { requestId, method, url: request.url, status: response.statusCode, durationMs: Math.round(Number(process.hrtime.bigint() - started) / 10_000) / 100, host };
        if (response.statusCode >= 500) logger.error('رلهٔ وب', record);
        else if (response.statusCode >= 400) logger.warn('رلهٔ وب', record);
        else logger.debug('رلهٔ وب', record);
        return;
      }
    }

    let formBody: string | undefined;
    const surface = resolveSite(config, host);
    if (method === 'POST' && surface && (['panel','admin'].includes(surface.kind)||(surface.kind==='public'&&/^\/forms\/(?:platform|[0-9a-f-]{36})\/[0-9a-f-]{36}$/.test(new URL(request.url??'/','http://localhost').pathname)))) {
      if (Number(request.headers['content-length'] ?? 0) > MAX_FORM_BYTES) { response.writeHead(413, { 'content-type': 'text/plain', 'cache-control': 'no-store', connection: 'close' }); response.end('payload too large'); request.resume(); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > MAX_FORM_BYTES) { response.writeHead(413, {'cache-control': 'no-store', connection: 'close'}); response.end('payload too large'); return; } chunks.push(chunk); }
      formBody = Buffer.concat(chunks).toString('utf8');
    }
    const result = await render({
      body: formBody, ip: request.socket.remoteAddress ?? '',
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      host,
      headers: {
        'x-request-id': typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : undefined,
        cookie: typeof request.headers.cookie === 'string' ? request.headers.cookie : undefined,
        origin: typeof request.headers.origin === 'string' ? request.headers.origin : undefined,
        'content-type': typeof request.headers['content-type'] === 'string' ? request.headers['content-type'] : undefined,
        'user-agent': typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined,
      },
    });

    if (result.cookies?.length) response.setHeader('set-cookie', [...result.cookies]);
    const headers: Record<string, string> = { ...result.headers };
    const etag = headers.etag;
    const ifNoneMatch = request.headers['if-none-match'];

    // ۳۰۴: همان چیزی که مرورگر دارد ⇒ صفر بایت.
    if (etag && typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').map((part) => part.trim()).includes(etag)) {
      const notModified = notModifiedHeaders(headers, etag);
      response.writeHead(304, notModified);
      response.end();
      logRequest(request, 304, started, notModified);
      return;
    }

    const acceptEncoding = String(request.headers['accept-encoding'] ?? '');
    let body: Buffer = result.bytes ?? Buffer.from(result.body, 'utf8');

    // فشرده‌سازی به «نوع محتوا» وابسته است، نه به رشته‌بودنِ بدنه: CSS دارایی هم بایت است ولی فشرده می‌شود؛
    // فونت و تصویر (که خودشان فشرده‌اند) نه.
    if (body.byteLength >= COMPRESS_THRESHOLD && isCompressible(headers['content-type'])) {
      const compressed = acceptEncoding.includes('br')
        ? brotliCompressSync(body)
        : acceptEncoding.includes('gzip')
          ? gzipSync(body)
          : body;
      if (compressed !== body) {
        body = compressed;
        headers['content-encoding'] = acceptEncoding.includes('br') ? 'br' : 'gzip';
        headers.vary = [headers.vary, 'accept-encoding'].filter(Boolean).join(', ');
      }
    }

    headers['content-length'] = String(body.byteLength);
    if (hasBody) headers.connection = 'close';

    response.writeHead(result.status, headers);
    // HEAD: هدرها کامل، بدنه خالی (طبق RFC).
    response.end(request.method === 'HEAD' ? undefined : body);
    logRequest(request, result.status, started, headers);
  }

  function logRequest(request: IncomingMessage, status: number, started: bigint, headers: Record<string, string>): void {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const record = {
      requestId: headers['x-request-id'],
      method: request.method,
      url: request.url,
      status,
      durationMs: Math.round(durationMs * 100) / 100,
      bytes: Number(headers['content-length'] ?? 0),
      host: request.headers.host,
    };

    /*
     * سطح لاگ به وضعیت پاسخ گره می‌خورد: خطای سرور `error`، خطای کاربر `warn`،
     * موفقیت `debug`. اگر همه `info` باشند، لاگ موفقیت‌های پرتکرار، سیگنال را
     * زیر نویز دفن می‌کند.
     */
    if (status >= 500) logger.error('پاسخ وب', record);
    else if (status >= 400) logger.warn('پاسخ وب', record);
    else logger.debug('پاسخ وب', record);
  }

  const webServer: WebServer = {
    server,
    config,
    assets,
    fonts,

    async listen(port, host) {
      await warmup();

      await new Promise<void>((resolve) => {
        server.listen(port, host ?? options.env.http.host, () => resolve());
      });

      // سقف زمان: اتصال کند نباید ظرفیت سرور را ببلعد.
      server.headersTimeout = 15_000;
      server.requestTimeout = 15_000;
      // بیش از idle timeout پنج‌ثانیه‌ای Agent کلاینت: بستن هم‌زمان، نخستین POST را reset نمی‌کند.
      server.keepAliveTimeout = 10_000;

      const address = server.address();
      return { port: typeof address === 'object' && address !== null ? address.port : port };
    },

    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },

    render,

    componentRegistry: () => registryCache.get(),

    async imagePipelineStatus() {
      return (await getEngine()).status();
    },

    async stylesheet() {
      return assets.body(await getCssAsset()).toString('utf8');
    },

    async budgetSnapshot() {
      const theme = await getTheme();
      const cssBytes = Buffer.byteLength(cssFor(theme), 'utf8');
      return {
        cssBytes,
        fontBytes: fonts.bytes,
        documents: assets.entries.length,
      };
    },
  };

  return webServer;
}

function pickRequestId(candidate: string | undefined): string {
  if (typeof candidate === 'string' && REQUEST_ID_PATTERN.test(candidate)) return candidate;
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function contentTypeFor(kind: PageResponse['kind']): string {
  switch (kind) {
    case 'html':
      return 'text/html; charset=utf-8';
    case 'xml':
      return 'application/xml; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    default:
      return 'text/plain; charset=utf-8';
  }
}

function isCompressible(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return /text\/|application\/(xml|json|javascript)|image\/svg\+xml/.test(contentType);
}
