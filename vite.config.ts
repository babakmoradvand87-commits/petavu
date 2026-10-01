import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {existsSync,renameSync} from 'node:fs';
const scopes=['web','panel','adminpanel','shop','adminshop'];
export default defineConfig(({mode})=>{
 const publicOnly=mode==='public';const scope=scopes.includes(mode)?mode:'preview';
 return {
  base:publicOnly?'./':'/',
  plugins:[react(),{name:'petavu-scope',transformIndexHtml(html){return html.replace('APP_SCOPE',scope)},closeBundle(){if(publicOnly&&existsSync('dist/public/coming-soon.html'))renameSync('dist/public/coming-soon.html','dist/public/index.html')}}],
  optimizeDeps:{include:['react','react-dom/client','lucide-react','three','three/examples/jsm/geometries/RoundedBoxGeometry.js']},
  server:{host:'0.0.0.0',port:5173,strictPort:true,allowedHosts:true},preview:{host:'0.0.0.0',port:4173,allowedHosts:true},
  build:{outDir:publicOnly?'dist/public':mode==='export'?'dist/export':`dist/${scope}`,assetsInlineLimit:1500000,cssCodeSplit:false,rolldownOptions:{input:publicOnly?resolve('coming-soon.html'):resolve('index.html'),output:{codeSplitting:mode!=='export'}}}
 };
});
