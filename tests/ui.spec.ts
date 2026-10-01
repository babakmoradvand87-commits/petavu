import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('five independent surfaces render without runtime errors',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const path of ['/','/panel/','/adminpanel/','/shop/','/adminshop/']){await page.goto(path);await expect(page.locator('h1')).toBeVisible();await expect(page.locator('body')).toContainText(/نمایشی|پیش‌نمایش/)}
 expect(errors).toEqual([]);
});
test('fluid layouts at mobile, tablet and desktop widths',async({page})=>{
 for(const width of [320,390,768,1024,1440,1920]){
  await page.setViewportSize({width,height:900});
  for(const path of ['/','/panel/','/panel/register','/shop/','/adminshop/']){
   await page.goto(path);await page.evaluate(()=>document.fonts.ready);
   const dimensions=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
   expect(dimensions.scroll,`${path} at ${width}px`).toBeLessThanOrEqual(dimensions.viewport+1);
  }
 }
});
test('membership demo preserves business category without creating a real account',async({page})=>{
 await page.goto('/panel/register?role=veterinary');
 await expect(page.getByRole('button',{name:'دامپزشک و مرکز درمانی',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'ادامهٔ معرفی'}).click();
 await page.getByLabel('نام کسب‌وکار').fill('مرکز تست نمایشی');
 await page.getByLabel('شهر فعالیت').fill('شهر تست');
 await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'ساخت پروفایل نمایشی'}).click();
 await expect(page.getByText('آمادهٔ قدم بعدی هستید.')).toBeVisible();
 await page.getByRole('link',{name:'مشاهدهٔ پنل نمونه'}).click();
 await expect(page.getByRole('heading',{level:1})).toContainText('خوش آمدید');
 await page.getByRole('button',{name:'پروفایل کسب‌وکار'}).click();
 await expect(page.getByLabel('نام کسب‌وکار')).toHaveValue('مرکز تست نمایشی');
 await expect(page.getByLabel('حوزهٔ فعالیت')).toHaveValue('veterinary');
 expect(await page.evaluate(()=>sessionStorage.getItem('petavu.demo_profile'))).not.toContain('@');
 await page.goto('/panel/login');await page.getByRole('button',{name:'ورود به پنل نمونه'}).click();await page.getByRole('button',{name:'پروفایل کسب‌وکار'}).click();await expect(page.getByLabel('حوزهٔ فعالیت')).toHaveValue('veterinary');
});
test('shop filtering and details modal are functional and keyboard dismissible',async({page})=>{
 await page.goto('/shop/');await page.getByRole('button',{name:'حوزهٔ اسب',exact:true}).click();
 await expect(page.locator('.shop-product-card')).toHaveCount(1);
 await page.getByRole('button',{name:'جزئیات نمونه'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'جزئیات نمونه'}).click();await page.getByRole('link',{name:'مسیر معرفی کسب‌وکار'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('h1')).toContainText('کسب‌وکارتان');
});
test('member directory search and profile save are explicitly local',async({page})=>{
 await page.goto('/panel/');await page.getByRole('button',{name:'شبکهٔ همکاران'}).click();
 await page.getByRole('textbox',{name:'جست‌وجوی کسب‌وکارهای نمونه'}).fill('دامپزشکی');
 await expect(page.locator('.partner-card')).toHaveCount(1);
 await page.getByRole('button',{name:'پروفایل کسب‌وکار'}).click();
 await page.getByLabel('نام کسب‌وکار').fill('پروفایل تست');await page.getByRole('button',{name:'ذخیرهٔ نمایشی'}).click();
 await expect(page.getByRole('status')).toContainText('به دیتابیس ارسال نشد');
});
test('motion control respects reduced-motion and toggles',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-motion','off');
 await page.getByRole('button',{name:'فعال‌کردن حرکت‌های تزئینی'}).click();
 await expect(page.locator('html')).toHaveAttribute('data-motion','on');
});
test('all visible touch targets satisfy 44x44, including checkbox label area',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 for(const path of ['/','/panel/','/panel/register','/shop/']){
  await page.goto(path);await page.evaluate(()=>document.fonts.ready);if(path==='/panel/register')await page.getByRole('button',{name:'ادامهٔ معرفی'}).click();
  const short=await page.locator('a,button,summary,input,select,textarea').evaluateAll(els=>els.flatMap(el=>{
   const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden'||!el.getClientRects().length)return[];
   const effective=(el instanceof HTMLInputElement&&el.type==='checkbox')?el.closest('label')||el:el;
   const r=effective.getBoundingClientRect();return r.width<43.5||r.height<43.5?[{text:el.textContent?.trim().slice(0,35),width:r.width,height:r.height,tag:el.tagName}]:[];
  }));expect(short,JSON.stringify({path,short})).toEqual([]);
 }
});
test('accessibility scan: landing, auth, member and shop have no serious/critical violations',async({page})=>{
 for(const path of ['/','/panel/register','/panel/','/adminpanel/','/shop/','/adminshop/']){
  await page.goto(path);await page.evaluate(()=>document.fonts.ready);
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  const violations=result.violations.filter(v=>v.impact==='serious'||v.impact==='critical');
  expect(violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),path).toEqual([]);
 }
});
test('real WebGL camera and chapter follow native scroll, without replacing it with an image',async({page})=>{
 await page.goto('/');await page.locator('.pet-world.ready').waitFor();
 const initial=await page.locator('.pet-world-host').getAttribute('data-camera');
 await page.evaluate(()=>{const el=document.querySelector<HTMLElement>('.scroll-story')!,pin=document.querySelector<HTMLElement>('.story-sticky')!,top=parseFloat(getComputedStyle(pin).top);window.scrollTo({top:scrollY+el.getBoundingClientRect().top-top+(el.offsetHeight-pin.offsetHeight)*.52,behavior:'instant'})});
 await page.waitForFunction(()=>parseFloat(document.querySelector<HTMLElement>('.pet-world-host')!.dataset.sceneProgress!)>.5);
 await expect(page.locator('.pet-world-host')).toHaveAttribute('data-renderer','webgl');
 expect(await page.locator('.pet-world-host').getAttribute('data-camera')).not.toBe(initial);
 await expect(page.locator('.story-copy')).toHaveAttribute('data-chapter','1');
});
test('separate public launch entry contains no member/admin/shop links or registration form',async({page})=>{
 await page.goto('/coming-soon.html');await expect(page.locator('h1')).toBeVisible();
 await expect(page.locator('body')).toContainText('به‌زودی');
 await expect(page.locator('a[href*="panel"],a[href*="shop"],form,.preview-dock')).toHaveCount(0);
 const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 expect(r.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
});
