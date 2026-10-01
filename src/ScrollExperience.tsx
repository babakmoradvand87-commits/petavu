import {asset} from './asset';
import {useEffect,useRef,useState,lazy,Suspense,type ReactNode} from 'react';
import {ArrowDown,ArrowUpLeft,ChevronLeft,MousePointer2,Orbit,MoveDownRight} from 'lucide-react';
import './scroll-experience.css';
const PetWorld=lazy(()=>import('./PetWorld'));
const chapters=[
 {label:'یک زیست‌بوم مشترک',title:<>یک دنیای مشترک.<br/><span>یک حلقهٔ حرفه‌ای.</span></>,text:'از پت‌شاپ و دامپزشکی تا اسب، تولید، تأمین و آموزش؛ پِتاو برای ارتباط حرفه‌ای میان کسب‌وکارهای این دنیای مشترک ساخته می‌شود.',caption:'از مراقبت تا همکاری',tag:'THE PET BUSINESS ECOSYSTEM'},
 {label:'ارتباط از زاویه‌ای تازه',title:<>تخصص‌های متفاوت.<br/><span>فرصت‌های مشترک.</span></>,text:'وقتی تولیدکننده، تأمین‌کننده و متخصص در یک شبکه قرار می‌گیرند، معرفی درست کسب‌وکار می‌تواند آغاز یک همکاری بهتر باشد.',caption:'نقش شما، نقطهٔ شروع ارتباط',tag:'A NEW PERSPECTIVE ON CONNECTION'},
 {label:'حلقهٔ بعدی، شما هستید',title:<>همکار به همکار.<br/><span>روشن و هدفمند.</span></>,text:'پِتاو یک فروشگاه برای مصرف‌کنندهٔ نهایی نیست. یک شبکهٔ B2B برای کسب‌وکارها و متخصصانی است که می‌خواهند حرفه‌ای‌تر با هم کار کنند.',caption:'۸ گروه حرفه‌ای، یک شبکه',tag:'BUSINESS TO BUSINESS'}
];
export default function ScrollExperience({motion,publicOnly=false,actions}:{motion:boolean;publicOnly?:boolean;actions?:ReactNode}){
 const section=useRef<HTMLElement>(null);const progress=useRef(0);const progressBar=useRef<HTMLSpanElement>(null);const[chapter,setChapter]=useState(0);const current=useRef(0);
 useEffect(()=>{
  let raf=0;const measure=()=>{raf=0;const el=section.current;if(!el)return;const r=el.getBoundingClientRect();const pinned=el.querySelector<HTMLElement>('.story-sticky');const top=parseFloat(getComputedStyle(pinned!).top)||0;const range=Math.max(1,r.height-(pinned?.offsetHeight||innerHeight));const p=Math.max(0,Math.min(1,(top-r.top)/range));progress.current=p;el.dataset.progress=p.toFixed(3);if(progressBar.current)progressBar.current.style.transform=`scaleX(${p})`;const c=p<.32?0:p<.69?1:2;if(c!==current.current){current.current=c;setChapter(c)}};
  const update=()=>{if(!raf)raf=requestAnimationFrame(measure)};window.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);measure();return()=>{cancelAnimationFrame(raf);window.removeEventListener('scroll',update);window.removeEventListener('resize',update)}
 },[]);
 function goToChapter(index:number){const el=section.current;if(!el)return;const pin=el.querySelector<HTMLElement>('.story-sticky')!;const top=parseFloat(getComputedStyle(pin).top)||0;const range=el.offsetHeight-pin.offsetHeight;const start=scrollY+el.getBoundingClientRect().top-top;window.scrollTo({top:Math.max(0,start+range*[0,.43,.87][index]),behavior:motion?'smooth':'instant'})}
 const c=chapters[chapter];
 return <section ref={section} id="story" className={'scroll-story '+(publicOnly?'public-story':'')} data-progress="0" aria-label="روایت سه‌بعدی اسکرولی پِتاو"><div className="story-sticky">
  <div className="story-background-word" aria-hidden="true" lang="en" dir="ltr">PETAVU</div>
  <div className="story-orbit-deco" aria-hidden="true"/>
  <div className="story-canvas"><Suspense fallback={<div className="pet-world"><img className="pet-world-fallback" src={asset('/images/petavu-ecosystem.webp')} alt="در حال آماده‌سازی صحنهٔ سه‌بعدی پِتاو"/></div>}><PetWorld progress={progress} motion={motion}/></Suspense></div>
  <div className="story-copy" data-chapter={chapter}><div className="story-kicker"><span className="story-dot"/><span>{publicOnly?'PETAVU · به‌زودی':c.label}</span><span className="story-chapter-number" dir="ltr">0{chapter+1} / 03</span></div><h1>{c.title}</h1><p>{c.text}</p><div className="story-actions">{chapter===0?<button className="story-button primary" onClick={()=>goToChapter(1)}>با اسکرول، شبکه را کشف کنید <ArrowDown size={20}/></button>:actions||<button className="story-button primary" onClick={()=>document.getElementById('launch-info')?.scrollIntoView({behavior:motion?'smooth':'instant'})}>پِتاو در راه است <ArrowUpLeft size={20}/></button>}<a href={publicOnly?'#launch-info':'#audiences'} className="story-skip">عبور از روایت <ChevronLeft size={16}/></a></div><div className="story-note"><Orbit size={17}/><span>{chapter===0?'با اسکرول، زاویهٔ دیدتان را عوض کنید.':c.caption}</span></div></div>
  <div className="scene-side-label" lang="en" dir="ltr"><span>{c.tag}</span><span>EST. PETAVU</span></div>
  <div className="story-bottom"><div className="story-chapters" aria-label="انتخاب مرحلهٔ روایت">{chapters.map((s,i)=><button key={s.label} className={chapter===i?'active':''} aria-current={chapter===i?'step':undefined} aria-label={`مرحلهٔ ${i+1}: ${s.label}`} onClick={()=>goToChapter(i)}><span dir="ltr">0{i+1}</span><span>{['زیست‌بوم','ارتباط','همکاری'][i]}</span></button>)}</div><span className="story-scroll-label"><MousePointer2 size={17}/><span>اسکرول کنید؛ صحنه همراه شماست</span><ArrowDown size={15}/></span><span className="story-progress"><span ref={progressBar}/></span></div>
  <div className="story-model-badge"><span className="story-dot"/><span>REALTIME 3D</span><span className="badge-separator"/>اسکرول طبیعی، بدون قفل حرکت</div>
 </div><div className="sr-only"><h2>متن کامل روایت پِتاو</h2><p>یک زیست‌بوم مشترک برای کسب‌وکارهای پت و اسب. تولیدکنندگان، تأمین‌کنندگان، پت‌شاپ‌ها، دامپزشکان، مراکز اسب، عمده‌فروشان، واردکنندگان و فعالان آموزش و خدمات تخصصی. شبکهٔ B2B همکار به همکار، نه فروشگاه مصرف‌کنندهٔ نهایی.</p></div></section>
}
