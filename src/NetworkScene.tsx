import {useEffect,useRef,useState} from 'react';
import {WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight, Group, BufferGeometry, Material, MeshStandardMaterial, TorusGeometry, Mesh, SphereGeometry, SRGBColorSpace} from 'three';
const T={WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight, Group, BufferGeometry, Material, MeshStandardMaterial, TorusGeometry, Mesh, SphereGeometry, SRGBColorSpace};
export default function NetworkScene({motion}:{motion:boolean}){
 const host=useRef<HTMLDivElement>(null);const active=useRef(motion);const[failed,setFailed]=useState(false);
 useEffect(()=>{active.current=motion},[motion]);
 useEffect(()=>{
  let disposed=false;let cleanup=()=>{};
  const build=()=>{
   if(disposed||!host.current)return;
   const el=host.current;let renderer:InstanceType<typeof T.WebGLRenderer>;
   try{renderer=new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'})}catch{setFailed(true);return}
   renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0x000000,0);renderer.outputColorSpace=T.SRGBColorSpace;el.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-hidden','true');
   const scene=new T.Scene();const camera=new T.PerspectiveCamera(32,1,.1,100);camera.position.set(0,1.4,6.8);camera.lookAt(0,0,0);
   scene.add(new T.AmbientLight(0xffffff,2.1));const key=new T.DirectionalLight(0xfff1d6,4);key.position.set(-3,5,5);scene.add(key);const fill=new T.DirectionalLight(0xc4e3d5,2);fill.position.set(3,0,2);scene.add(fill);
   const group=new T.Group();scene.add(group);const geometries:InstanceType<typeof T.BufferGeometry>[]=[];const materials:InstanceType<typeof T.Material>[]=[];
   const material=(color:number,metalness=.05)=>{const m=new T.MeshStandardMaterial({color,metalness,roughness:.38});materials.push(m);return m};
   const orange=material(0xe57446,.15),cream=material(0xede9dc),sage=material(0xb4c6a1),gold=material(0xf4c279,.2);
   const torusGeo=new T.TorusGeometry(1.28,.055,16,100);geometries.push(torusGeo);const orbit=new T.Mesh(torusGeo,orange);orbit.rotation.x=Math.PI/2.9;group.add(orbit);
   const innerGeo=new T.TorusGeometry(.64,.135,22,80);geometries.push(innerGeo);const inner=new T.Mesh(innerGeo,cream);inner.rotation.set(.25,.2,.3);group.add(inner);
   const orbGeo=new T.SphereGeometry(.32,36,24);geometries.push(orbGeo);const core=new T.Mesh(orbGeo,orange);core.position.set(0,0,.2);group.add(core);
   const nodeGeo=new T.SphereGeometry(.13,24,18);geometries.push(nodeGeo);for(let i=0;i<8;i++){const angle=i*Math.PI/4;const node=new T.Mesh(nodeGeo,[sage,gold,cream,orange][i%4]);node.position.set(Math.cos(angle)*1.28,Math.sin(angle)*.65,Math.sin(angle)*.97);group.add(node)}
   let visible=true,dragging=false,lastX=0,raf=0,lastTime=0;const io=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting},{threshold:.05});io.observe(el);
   const resize=()=>{const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.render(scene,camera)};const ro=new ResizeObserver(resize);ro.observe(el);resize();
   const canvas=renderer.domElement;const down=(e:PointerEvent)=>{dragging=true;lastX=e.clientX;canvas.setPointerCapture(e.pointerId)};const move=(e:PointerEvent)=>{if(dragging){group.rotation.y+=(e.clientX-lastX)*.007;lastX=e.clientX}};const up=()=>{dragging=false};canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);
   const frame=(time:number)=>{raf=requestAnimationFrame(frame);if(!visible||time-lastTime<32||(!active.current&&!dragging))return;lastTime=time;if(active.current&&!dragging){group.rotation.y+=.004;inner.rotation.z+=.0015}renderer.render(scene,camera)};raf=requestAnimationFrame(frame);
   cleanup=()=>{cancelAnimationFrame(raf);io.disconnect();ro.disconnect();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());renderer.dispose();canvas.remove()};
  };try{build()}catch{setFailed(true)}return()=>{disposed=true;cleanup()}
 },[]);
 return <div className="network-scene" role="img" aria-label="نمای تعاملی سه‌بعدی حلقهٔ کسب‌وکارها؛ تولید، تأمین، پت‌شاپ، دامپزشکی، اسب، عمده‌فروشی، واردات و آموزش. همهٔ این نقش‌ها در متن سایت هم معرفی شده‌اند."><div className="webgl-host" ref={host}/>{failed&&<img className="webgl-fallback" src="/images/petavu-ecosystem.webp" alt=""/>}<span className="network-node node-1">تولید</span><span className="network-node node-2">تأمین</span><span className="network-node node-3">پت‌شاپ</span><span className="network-node node-4">سلامت</span><span className="network-node node-5">آموزش</span><span className="network-node node-6">حوزهٔ اسب</span><span className="network-node node-7">عمده‌فروشی</span><span className="network-node node-8">واردات</span><div className="scene-brand" lang="en" dir="ltr">PETAVU</div></div>
}
