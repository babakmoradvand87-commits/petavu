/* §35–38، Addendum §96–100: رندر، ساختار، امنیت و اندازه‌گیری Preview از همان کد سایت. */
import {definitionFindings,type Definition} from './nocode.js';
import { fileURLToPath } from 'node:url';
import { buildHead } from '@petavu/seo';
import { createAssetRegistry } from './assets.js';
import { siteHeader, siteFooter } from './components.js';
import { createFontSetup } from './fonts.js';
import { escapeText, tag } from './html.js';
import { measurePage, type PageReport } from './measure.js';
import { createRegistry, type RegistryRow, type Finding } from './registry.js';
import { renderDocument } from './render.js';
import type { MediaView, TreeData } from './renderers.js';
import { SHELL_CSS } from './styles.js';
import { jsonLdBlocks } from './structured.js';
import { buildTheme } from './theme.js';
import { buildTokenSet, type TokenRow } from './tokens.js';
import { renderTree, scanTree } from './tree.js';

export interface BundlePage {id:string;key:string;title:string;description:string|null;tree:unknown;version:number;revision:number}
export interface DesignBundle { pages:BundlePage[];definitions?:Definition[];registry?:RegistryRow[];tokens:TokenRow[];themes:Array<{settings:Record<string,unknown>;business_id?:string|null;is_default?:boolean}>;seo:Record<string,unknown> }
export interface PreviewPage {id:string;path:string;html:string;fragment:string;css:string;delivery:PageReport;findings:Finding[];h1Count:number;outline:readonly {level:number;text:string;id:string}[]}
export function publicDesignPath(key:string,businessSlug:string|null=null):string {
 if(businessSlug)return `/b/${encodeURIComponent(businessSlug)}${key==='home'?'':`/${encodeURIComponent(key)}`}`;
 if(key==='home')return '/';if(['about','contact','privacy','terms'].includes(key))return `/${key}`;return `/p/${encodeURIComponent(key)}`;
}
const DEFAULT_ASSETS=fileURLToPath(new URL('../../../apps/web/assets/',import.meta.url));
export const PIPELINE_STAGES=['CHANGE','VALIDATE','SECURITY','DB','API','PERFORMANCE','A11Y','SEO','SD','SEARCH','SITEMAP','AI','AUTOMATION','PREVIEW','APPROVAL','PUBLISH','MONITOR','AUDIT'] as const;
function luminance(hex:string):number|null {let value=hex.replace(/^#/,'');if(/^[0-9a-f]{3}$/i.test(value))value=[...value].map(v=>v+v).join('');if(!/^[0-9a-f]{6}$/i.test(value))return null;const rgb=[0,2,4].map(i=>parseInt(value.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return rgb[0]!*0.2126+rgb[1]!*0.7152+rgb[2]!*0.0722;}
export function contrastRatio(foreground:string,background:string):number|null {const a=luminance(foreground),b=luminance(background);return a===null||b===null?null:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);}
export async function compilePreview(input:{bundle:DesignBundle;registry:RegistryRow[];origin:string;businessSlug:string|null;data:TreeData;strings:Readonly<Record<string,string>>;media:ReadonlyMap<string,MediaView>;fetchMedia:(id:string)=>Promise<{status:number;contentType:string;bytes:Buffer}>;assetsDirectory?:string}):Promise<{pages:PreviewPage[];tokenFindings:Finding[]}> {
 const registry=createRegistry(input.bundle.registry??input.registry), assets=createAssetRegistry({directory:input.assetsDirectory??DEFAULT_ASSETS});
 const theme=buildTheme(input.bundle.tokens.map(t=>({...t,description:t.description??null})),[...input.bundle.themes].reverse().find(t=>t.is_default)?.settings??input.bundle.themes.at(-1)?.settings??{}),fonts=createFontSetup({assets,publicOrigin:input.origin,assetsDirectory:input.assetsDirectory??DEFAULT_ASSETS});
 const css=[theme.css,fonts.faceCss,SHELL_CSS].join('\n\n');const stylesheet=assets.registerGenerated('preview.css',css,'text/css; charset=utf-8');
 const tokenFindings:Finding[]=[...definitionFindings(input.bundle.definitions??[]),...theme.rejected.map(v=>({rule:'security.token',severity:'blocker' as const,message:v.reason,path:v.key})),...theme.unresolved.map(v=>({rule:'tokens.alias',severity:'blocker' as const,message:'ارجاع حل نشده',path:v}))];
 for(const mode of ['light','dark','high_contrast'] as const){const built=buildTokenSet(input.bundle.tokens,mode);
 for(const [foreground,background] of [['color.text','color.bg'],['color.text','color.surface'],['color.text.muted','color.surface'],['color.link','color.bg'],['color.on.primary','color.brand.600']] as const){const fg=built.tokens.get(foreground),bg=built.tokens.get(background);if(!fg||!bg)continue;const ratio=contrastRatio(fg,bg);if(ratio===null||ratio<4.5)tokenFindings.push({rule:'a11y.contrast',severity:'blocker',message:`${mode}/${foreground}/${background}: ${ratio===null?'رنگ غیرقابل‌سنجش در موتور انتشار':ratio.toFixed(2)+' < 4.5'}`});}
 const touch=built.tokens.get('size.touch.target');if(touch&&(!/^\d+(?:\.\d+)?px$/.test(touch)||parseFloat(touch)<44))tokenFindings.push({rule:'a11y.touch',severity:'blocker',message:'هدف لمس کمتر از ۴۴ پیکسل است.'});}
 for(const t of input.bundle.themes){const min=t.settings['touch_target_min_px'];if(typeof min==='number'&&min<44)tokenFindings.push({rule:'a11y.touch',severity:'blocker',message:'تم هدف لمس کمتر از ۴۴ دارد.'});}
 const pages:PreviewPage[]=[];
 for(const page of input.bundle.pages){const path=publicDesignPath(page.key,input.businessSlug);const scan=scanTree(page.tree,{registry,strings:input.strings});const rendered=renderTree({scan,registry,strings:input.strings,data:input.data,pageUrl:input.origin+path,locale:String(input.bundle.seo['default_locale']??'fa-IR'),media:id=>input.media.get(id)??null});
 const findings=[...rendered.findings];if(scan.unrenderable.size)for(const [key,reason] of scan.unrenderable)findings.push({rule:'registry.unrenderable',severity:'blocker',message:reason,path:key});
 const h1Count=scan.outline.filter(v=>v.level===1).length;if(h1Count!==1)findings.push({rule:'a11y.single_h1',severity:'blocker',message:'صفحه دقیقاً یک عنوان سطح اول لازم دارد.'});
 for(let i=1;i<scan.outline.length;i++)if(scan.outline[i]!.level>scan.outline[i-1]!.level+1)findings.push({rule:'a11y.heading_jump',severity:'blocker',message:'پرش سطح عنوان مجاز نیست.'});
 if(page.title.trim().length<2||page.title.length>200)findings.push({rule:'seo.title',severity:'blocker',message:'عنوان متادیتا معتبر نیست.'});
 for(const assetId of scan.assetIds)if(!input.media.has(assetId))findings.push({rule:'security.asset_scope',severity:'blocker',message:'دارایی حاضر، قابل‌نمایش و متعلق به محدوده نیست.',path:assetId});
 for(const tagImage of rendered.html.matchAll(/<img\s([^>]*)>/g))if(!/\balt=/.test(tagImage[1]??'')||!/\bwidth=/.test(tagImage[1]??'')||!/\bheight=/.test(tagImage[1]??''))findings.push({rule:'a11y.image',severity:'blocker',message:'تصویر بدون alt یا ابعاد.'});
 const siteName=input.strings['site_name']??'PETAVU';const head=buildHead({url:input.origin+path,title:page.title,description:page.description,indexable:false,environment:'preview'});
 const blocks=jsonLdBlocks({baseUrl:input.origin,brandName:siteName,nodes:[{'@type':'WebPage','@id':input.origin+path+'#page',url:input.origin+path,name:page.title,...(page.description?{description:page.description}:{})}]});
 const html=renderDocument({lang:String(input.bundle.seo['default_locale']??'fa-IR'),dir:'rtl',headTags:head,stylesheets:[stylesheet.url],preloadUrls:fonts.preloadUrls,theme,faviconUrl:assets.url('favicon.svg'),siteName,jsonLd:blocks,header:siteHeader({siteKind:'public',currentPath:path,siteName,items:input.bundle.pages.map(v=>({href:publicDesignPath(v.key,input.businessSlug),label:v.title}))}),main:rendered.html,footer:siteFooter({siteName,year:new Date().getUTCFullYear(),columns:[]}),skip:tag('a',{class:'skip-link',href:'#main'},escapeText('رفتن به محتوای اصلی')),scripts:[assets.url('vitals.js')],rumSampleRate:0});
 const delivery=await measurePage({path,origin:input.origin,fetch:async(resourcePath)=>{if(resourcePath===path)return {status:200,contentType:'text/html',bytes:Buffer.from(html)};const asset=assets.resolve(resourcePath);if(asset)return {status:200,contentType:asset.contentType,bytes:assets.body(asset)};const id=/^\/media\/([0-9a-f-]{36})/.exec(resourcePath)?.[1];if(id)return input.fetchMedia(id);return {status:404,contentType:'text/plain',bytes:Buffer.alloc(0)};}});
 pages.push({id:page.id,path,html,fragment:rendered.html,css,delivery,findings,h1Count,outline:scan.outline});
 }
 return {pages,tokenFindings};
}
