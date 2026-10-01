import {asset} from './asset';
import {useEffect,useRef,useState,type MutableRefObject} from 'react';
import {WebGLRenderer,Scene,PerspectiveCamera,Color,Group,Vector3,Mesh,MeshPhysicalMaterial,MeshStandardMaterial,SphereGeometry,CylinderGeometry,ConeGeometry,TorusGeometry,TubeGeometry,CatmullRomCurve3,PlaneGeometry,ShadowMaterial,DirectionalLight,HemisphereLight,AmbientLight,PCFSoftShadowMap,ACESFilmicToneMapping,SRGBColorSpace,CanvasTexture,PMREMGenerator,EquirectangularReflectionMapping,Sprite,SpriteMaterial,type BufferGeometry,type Material,type Texture} from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
type Props={progress:MutableRefObject<number>;motion:boolean};
/** All visible models are actual meshes. No raster image is used when WebGL succeeds. */
export default function PetWorld({progress,motion}:Props){
 const host=useRef<HTMLDivElement>(null);const active=useRef(motion);const[ready,setReady]=useState(false);const[failed,setFailed]=useState(false);
 useEffect(()=>{active.current=motion},[motion]);
 useEffect(()=>{
  if(!host.current)return;const el=host.current;let destroyed=false;let cleanup=()=>{};
  try{
   const renderer=new WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
   renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<700?1.25:1.65));renderer.setClearColor(0xf7f4ec,0);
   renderer.outputColorSpace=SRGBColorSpace;renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
   renderer.shadowMap.enabled=true;renderer.shadowMap.type=PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
   const canvas=renderer.domElement;canvas.setAttribute('aria-hidden','true');el.appendChild(canvas);el.dataset.renderer='webgl';
   const scene=new Scene();const camera=new PerspectiveCamera(32,1,.1,60);const root=new Group();scene.add(root);
   const geometries:BufferGeometry[]=[],materials:Material[]=[],textures:Texture[]=[];
   const geo=<T extends BufferGeometry>(g:T)=>{geometries.push(g);return g};
   const sphere=geo(new SphereGeometry(1,32,24));const cylinder=geo(new CylinderGeometry(1,1,1,48));const cone=geo(new ConeGeometry(1,1,32));const roundBox=geo(new RoundedBoxGeometry(1,1,1,4,.08));
   function ceramic(color:number,roughness=.32){const m=new MeshPhysicalMaterial({color,roughness,metalness:0,clearcoat:.35,clearcoatRoughness:.25});materials.push(m);return m}
   const cream=ceramic(0xf3edde),white=ceramic(0xfffbf1),sage=ceramic(0xa6b993),forest=ceramic(0x2e493b),orange=ceramic(0xe77647,.25),gold=ceramic(0xdeb875),eyes=ceramic(0x172a20,.16),earPink=ceramic(0xc6b398),paleSage=ceramic(0xd9e3cf);
   function mesh(g:BufferGeometry,m:Material,parent:Group,at:[number,number,number],scale:[number,number,number],shadow=true){const o=new Mesh(g,m);o.position.set(...at);o.scale.set(...scale);o.castShadow=shadow;o.receiveShadow=shadow;parent.add(o);return o}
   const ell=(parent:Group,material:Material,at:[number,number,number],scale:[number,number,number])=>mesh(sphere,material,parent,at,scale);
   const box=(parent:Group,material:Material,at:[number,number,number],scale:[number,number,number])=>mesh(roundBox,material,parent,at,scale);
   scene.add(new HemisphereLight(0xfffbef,0xb5c1a4,2.3));scene.add(new AmbientLight(0xffffff,.3));
   const key=new DirectionalLight(0xfff0da,3.6);key.position.set(-3,7,5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-5;key.shadow.camera.right=5;key.shadow.camera.top=5;key.shadow.camera.bottom=-5;key.shadow.normalBias=.04;key.shadow.bias=-.00015;scene.add(key);
   const rim=new DirectionalLight(0xe8f3e3,2.1);rim.position.set(4,3,-2);scene.add(rim);
   // A generated, local studio environment creates real reflections without an HDR/CDN dependency.
   const studio=document.createElement('canvas');studio.width=512;studio.height=256;const sc=studio.getContext('2d')!;
   const sky=sc.createLinearGradient(0,0,0,256);sky.addColorStop(0,'#a8b5a0');sky.addColorStop(.5,'#ebe9df');sky.addColorStop(1,'#778270');sc.fillStyle=sky;sc.fillRect(0,0,512,256);
   sc.fillStyle='#ffffff';sc.fillRect(90,30,48,95);sc.fillRect(355,15,85,80);sc.fillStyle='#faf4e9';sc.fillRect(218,40,55,42);
   const env=new CanvasTexture(studio);env.mapping=EquirectangularReflectionMapping;env.colorSpace=SRGBColorSpace;
   const pmrem=new PMREMGenerator(renderer);const envTarget=pmrem.fromEquirectangular(env);scene.environment=envTarget.texture;pmrem.dispose();env.dispose();
   const floorMaterial=new ShadowMaterial({opacity:.17});materials.push(floorMaterial);const floor=new Mesh(geo(new PlaneGeometry(24,24)),floorMaterial);floor.rotation.x=-Math.PI/2;floor.position.y=-1.38;floor.receiveShadow=true;scene.add(floor);
   const platform=new Group();root.add(platform);mesh(cylinder,white,platform,[0,-1.26,0],[2.04,.16,2.04]);mesh(cylinder,cream,platform,[0,-1.34,0],[2.09,.06,2.09]);
   const animals=new Group();root.add(animals);
   const dog=new Group();dog.position.set(-.52,-.42,.25);animals.add(dog);
   ell(dog,cream,[0,.07,0],[.45,.65,.32]);ell(dog,cream,[0,.75,.015],[.46,.46,.36]);
   const e1=ell(dog,earPink,[-.43,.62,0],[.13,.32,.13]);e1.rotation.z=-.15;const e2=ell(dog,earPink,[.43,.62,0],[.13,.32,.13]);e2.rotation.z=.15;
   ell(dog,white,[-.12,.55,.33],[.18,.16,.19]);ell(dog,white,[.12,.55,.33],[.18,.16,.19]);ell(dog,eyes,[0,.62,.51],[.072,.046,.052]);
   for(const x of [-.195,.195]){ell(dog,eyes,[x,.83,.318],[.042,.046,.025]);ell(dog,white,[x-.01,.845,.341],[.009,.01,.006]);}
   ell(dog,cream,[-.20,-.52,.12],[.19,.13,.22]);ell(dog,cream,[.20,-.52,.12],[.19,.13,.22]);
   // Narrow collar / medallion rather than a cartoon costume.
   const collar=new Mesh(geo(new TorusGeometry(.292,.023,12,56)),orange);collar.rotation.x=Math.PI/2;collar.position.y=.29;dog.add(collar);ell(dog,gold,[0,.255,.335],[.052,.064,.022]);
   const cat=new Group();cat.position.set(.46,-.65,.62);cat.scale.setScalar(.94);animals.add(cat);
   ell(cat,sage,[0,.13,0],[.32,.48,.26]);ell(cat,sage,[0,.70,.005],[.34,.32,.28]);
   for(const x of [-.23,.23]){const ear=mesh(cone,sage,cat,[x,1.01,-.035],[.15,.34,.13]);ear.rotation.z=x<0?.19:-.19;const inside=mesh(cone,paleSage,cat,[x,1.015,.042],[.088,.20,.028]);inside.rotation.z=ear.rotation.z;}
   for(const x of [-.125,.125]){ell(cat,eyes,[x,.745,.261],[.046,.031,.021]);ell(cat,white,[x-.012,.753,.28],[.007,.008,.006]);}
   ell(cat,cream,[-.053,.607,.265],[.075,.055,.045]);ell(cat,cream,[.053,.607,.265],[.075,.055,.045]);ell(cat,orange,[0,.64,.31],[.026,.02,.02]);
   ell(cat,sage,[-.14,-.26,.12],[.115,.09,.15]);ell(cat,sage,[.14,-.26,.12],[.115,.09,.15]);
   const tailCurve=new CatmullRomCurve3([new Vector3(.22,-.21,-.12),new Vector3(.50,-.18,-.15),new Vector3(.64,.15,-.11),new Vector3(.56,.40,-.08)]);cat.add(new Mesh(geo(new TubeGeometry(tailCurve,30,.058,12,false)),sage));
   const horse=new Group();horse.position.set(1.15,-.54,-.28);horse.scale.setScalar(.78);horse.rotation.y=-.40;animals.add(horse);
   const neck=ell(horse,forest,[0,.27,-.05],[.27,.64,.25]);neck.rotation.x=.1;ell(horse,forest,[0,-.25,-.02],[.41,.23,.30]);
   const head=ell(horse,forest,[0,.90,.15],[.23,.37,.32]);head.rotation.x=-.45;ell(horse,forest,[0,.65,.48],[.22,.16,.25]);
   for(const x of [-.14,.14]){const ear=mesh(cone,forest,horse,[x,1.26,.055],[.085,.32,.078]);ear.rotation.x=-.20;ell(horse,eyes,[x*1.52,1.00,.26],[.028,.032,.025]);ell(horse,eyes,[x,.65,.694],[.026,.018,.015]);}
   for(let i=0;i<6;i++){const m=ell(horse,eyes,[0,.40+i*.14,-.26+i*.025],[.08,.14,.046]);m.rotation.x=-.10;}
   const sculpture=new Group();root.add(sculpture);
   const arch=new Mesh(geo(new TorusGeometry(1.63,.155,24,120)),orange);arch.position.set(0,.35,-.62);arch.rotation.y=-.08;arch.castShadow=true;sculpture.add(arch);
   const ribbonCurve=new CatmullRomCurve3([new Vector3(-1.8,.2,.12),new Vector3(-1.12,-.30,1.16),new Vector3(.35,-.05,1.14),new Vector3(1.87,.68,.30),new Vector3(1.40,.70,-1.18),new Vector3(-.40,.5,-1.46),new Vector3(-1.84,.24,-.5)],true);
   const ribbon=new Mesh(geo(new TubeGeometry(ribbonCurve,120,.060,16,true)),orange);sculpture.add(ribbon);
   const orbital=new Group();root.add(orbital);const thinRing=new Mesh(geo(new TorusGeometry(2.63,.015,8,120)),white);thinRing.rotation.x=Math.PI/2;thinRing.position.y=-.63;orbital.add(thinRing);
   const nodes:Group[]=[];const nodeMats=[orange,sage,gold,forest,paleSage,cream,forest,gold];
   for(let i=0;i<8;i++){
    const n=new Group();nodes.push(n);root.add(n);const mat=nodeMats[i];
    mesh(cylinder,white,n,[0,-.18,0],[.34,.07,.34],false);
    if(i===0||i===3||i===6){box(n,mat,[0,.06,0],[.29,.40,.14]);box(n,cream,[0,.07,.084],[.14,.15,.025]);}
    else if(i===1){box(n,mat,[0,.055,0],[.115,.42,.15]);box(n,mat,[0,.055,0],[.36,.115,.15]);}
    else if(i===2){box(n,mat,[0,-.035,0],[.32,.20,.20]);const roof=mesh(cone,mat,n,[0,.15,0],[.29,.21,.22],false);roof.rotation.y=Math.PI/4;}
    else if(i===4){box(n,mat,[-.055,.015,0],[.27,.31,.20]);box(n,cream,[.11,.0,0],[.10,.24,.18]);}
    else if(i===5){box(n,mat,[-.11,0,0],[.15,.25,.17]);box(n,mat,[.09,.05,0],[.20,.35,.17]);}
    else {box(n,mat,[-.07,.035,0],[.12,.34,.20]);box(n,sage,[.07,.035,0],[.12,.34,.20]);}
   }
   // PETAVU studio label is a local canvas texture, not an image of the 3D scene.
   const labelCanvas=document.createElement('canvas');labelCanvas.width=512;labelCanvas.height=128;const lc=labelCanvas.getContext('2d')!;
   function drawLabel(){lc.clearRect(0,0,512,128);lc.fillStyle='#283e32';lc.font='800 68px Manrope, sans-serif';lc.textAlign='center';lc.textBaseline='middle';lc.fillText('PETAVU',256,64);}
   drawLabel();const labelTexture=new CanvasTexture(labelCanvas);labelTexture.colorSpace=SRGBColorSpace;textures.push(labelTexture);const labelMat=new SpriteMaterial({map:labelTexture,transparent:true,depthTest:false});materials.push(labelMat);const label=new Sprite(labelMat);label.position.set(0,-1.08,1.20);label.scale.set(1.16,.29,1);root.add(label);
   let visible=true,raf=0,lastTime=0,lastProgress=-1,needsRender=true,mouseX=0,mouseY=0,smoothed=progress.current,readyNotified=false;
   document.fonts.ready.then(()=>{if(!destroyed){drawLabel();labelTexture.needsUpdate=true;needsRender=true}});
   const observer=new IntersectionObserver(([e])=>{visible=e.isIntersecting;if(visible)needsRender=true},{threshold:0});observer.observe(el);
   const resize=()=>{const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.fov=innerWidth<700?38:32;camera.updateProjectionMatrix();needsRender=true;renderer.shadowMap.needsUpdate=true};const ro=new ResizeObserver(resize);ro.observe(el);resize();
   const pointer=(e:PointerEvent)=>{if(!active.current)return;const r=el.getBoundingClientRect();mouseX=((e.clientX-r.left)/r.width-.5);mouseY=((e.clientY-r.top)/r.height-.5);needsRender=true};const leave=()=>{mouseX=mouseY=0;needsRender=true};el.addEventListener('pointermove',pointer);el.addEventListener('pointerleave',leave);
   const target=new Vector3(0,.14,0);const start=new Vector3(2.75,2.05,8.6),middle=new Vector3(-3.2,3.1,8.0),end=new Vector3(.85,5.4,9.4);const position=new Vector3();
   function smooth(t:number){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t)}
   const frame=(time:number)=>{
    raf=requestAnimationFrame(frame);if(!visible||document.hidden||time-lastTime<32)return;lastTime=time;
    const desired=progress.current;const before=smoothed;smoothed=active.current?smoothed+(desired-smoothed)*.16:desired;
    const p=active.current?smoothed:0;const changing=Math.abs(before-smoothed)>.0002||Math.abs(lastProgress-p)>.0002;
    if(!needsRender&&!changing)return;
    if(p<.52)position.lerpVectors(start,middle,smooth(p/.52));else position.lerpVectors(middle,end,smooth((p-.52)/.48));
    const mobile=innerWidth<700;if(mobile){position.multiplyScalar(1.06);position.y+=.15;}
    camera.position.copy(position);if(active.current){camera.position.x+=mouseX*.24;camera.position.y-=mouseY*.13;}camera.lookAt(target);
    root.rotation.y=active.current?p*.18:0;
    const expand=smooth((p-.18)/.65);animals.scale.setScalar(1-expand*.12);sculpture.scale.setScalar(1-expand*.08);
    for(let i=0;i<nodes.length;i++){const angle=i*Math.PI/4+.3;const radius=2.15+expand*.70;nodes[i].position.set(Math.cos(angle)*radius,-.62+Math.sin(angle)*.13,Math.sin(angle)*radius);nodes[i].scale.setScalar(.40+expand*.60);nodes[i].rotation.y=-angle+.2;}
    orbital.scale.setScalar(.85+expand*.22);thinRing.rotation.z=active.current?(p-.5)*.10:0;
    if(changing||needsRender)renderer.shadowMap.needsUpdate=true;
    renderer.render(scene,camera);el.dataset.camera=camera.position.toArray().map(v=>v.toFixed(3)).join(',');el.dataset.sceneProgress=p.toFixed(3);lastProgress=p;needsRender=false;
    if(!readyNotified&&!destroyed){readyNotified=true;setReady(true);}
   };
   raf=requestAnimationFrame(frame);
   cleanup=()=>{cancelAnimationFrame(raf);observer.disconnect();ro.disconnect();el.removeEventListener('pointermove',pointer);el.removeEventListener('pointerleave',leave);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());envTarget.dispose();renderer.dispose();canvas.remove();delete el.dataset.renderer;};
  }catch{setFailed(true);el.dataset.renderer='fallback';}
  return()=>{destroyed=true;cleanup()};
 },[]);
 return <div className={'pet-world '+(ready?'ready':'')}><div className="pet-world-host" ref={host} role="img" aria-label="صحنهٔ واقعی سه‌بعدی پِتاو: مجسمه‌های سگ، گربه و اسب، حلقهٔ پیوسته و هشت جایگاه کسب‌وکار؛ دوربین با اسکرول تغییر می‌کند."/>{(!ready||failed)&&<img className="pet-world-fallback" src={asset('/images/petavu-ecosystem.webp')} alt="حلقهٔ همکاری پت و اسب؛ نسخهٔ تصویری در مرورگرهای فاقد WebGL"/>}</div>
}
