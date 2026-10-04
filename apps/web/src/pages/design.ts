/* §35–40: صفحهٔ منتشرشدهٔ استودیو، همان رندر و هد عمومی؛ نه لینک خصوصیِ Preview. */
import { renderShell, PLATFORM_NAME } from '../chrome.js';
import { buildTheme } from '../theme.js';
import { SHELL_CSS } from '../styles.js';
import { buildPageHead } from '../seohead.js';
import { renderDesignPage } from '../pagedesign.js';
import { jsonLdBlocks } from '../structured.js';
import { notFoundPage } from './system.js';
import type { PageContext,PageResponse } from './types.js';
export async function publicDesignPage(context:PageContext,key:string,businessSlug:string|null):Promise<PageResponse>{
 const found=businessSlug?await context.data.businessBySlug(businessSlug,context.requestId):null;if(businessSlug&&!found)return notFoundPage(context,{reason:'design_business_not_public'});
 const businessId=found?.business.id??null;const row=await context.data.designPage({businessId,key},context.requestId);if(!row)return notFoundPage(context,{reason:'design_page_not_published'});
 let ctx=context;if(businessId){const theme=buildTheme(await context.data.themeTokens(context.requestId,businessId),await context.data.themeSettings(context.requestId,businessId));const stylesheet=context.assets.registerGenerated(`business-${businessId}.css`,[theme.css,context.fonts.faceCss,SHELL_CSS].join('\n\n'),'text/css; charset=utf-8');ctx={...context,theme,stylesheetUrl:stylesheet.url};}
 const path=context.url.pathname;const render=await renderDesignPage({context:ctx,businessId,key,pageUrl:context.config.env.origins.public+path,business:found?.business??null,strings:{business_name:found?.business.name??context.siteName,site_name:context.siteName,tagline:found?.business.tagline??''}});
 if(!render.used||!render.html)return notFoundPage(ctx,{reason:'design_empty'});
 const plain=render.html.replace(/<[^>]*>/g,'').trim();
 const head=await buildPageHead({context:ctx,site:ctx.site,path,search:ctx.url.searchParams,entity:{kind:'content',id:null,routeKey:path,values:{title:row.title,description:row.description??'',site:PLATFORM_NAME}},fallbackTitle:row.title,fallbackDescription:row.description,indexable:plain.length>=80,nonIndexableReason:plain.length>=80?null:'thin_design_page'});
 return{status:200,kind:'html',cacheable:!render.hasForms,body:renderShell({config:ctx.config,site:ctx.site,url:ctx.url,siteName:ctx.siteName,headTags:head.tags,theme:ctx.theme,stylesheetUrl:ctx.stylesheetUrl,fonts:ctx.fonts,assets:ctx.assets,chrome:ctx.chrome,now:ctx.now,content:render.html,jsonLd:jsonLdBlocks({baseUrl:ctx.config.env.origins.public,brandName:ctx.siteName,nodes:[{'@type':'WebPage','@id':head.canonical+'#page',url:head.canonical,name:row.title,...(row.description?{description:row.description}:{})},...head.structuredNodes]}),bodyClass:'page-design'})};
}
