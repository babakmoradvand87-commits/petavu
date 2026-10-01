import {execFileSync} from 'node:child_process';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import path from 'node:path';
execFileSync(process.platform==='win32'?'npx.cmd':'npx',['vite','build','--mode','export'],{stdio:'inherit'});
const assets=await readdir('dist/export/assets');const js=assets.find(x=>x.endsWith('.js'));const css=assets.find(x=>x.endsWith('.css'));
let html=await readFile('dist/export/index.html','utf8');let script=await readFile('dist/export/assets/'+js,'utf8');let style=await readFile('dist/export/assets/'+css,'utf8');
const embeds=[['/fonts/Vazirmatn.woff2','font/woff2'],['/fonts/Manrope.woff2','font/woff2'],['/images/petavu-ecosystem.webp','image/webp'],['/brand/petavu-logo.svg','image/svg+xml'],['/brand/petavu-mark.svg','image/svg+xml']];
for(const [src,type] of embeds){const data='data:'+type+';base64,'+(await readFile('public'+src)).toString('base64');html=html.replaceAll(src,data);script=script.replaceAll(src,data);style=style.replaceAll(src,data)}
html=html.replace(/<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/g,'').replace(/<link rel="stylesheet"[^>]+>/g,'').replace(/<link rel="modulepreload"[^>]+>/g,'').replace('<script src="/runtime-config.js"></script>','');
html=html.replace('</head>',()=>'<style>'+style+'</style></head>');
const cfg={scope:'preview',mode:'demo',baseDomain:'',apiBase:'/api',routing:'hash'};
html=html.replace('</body>',()=>'<script>window.__PETAVU_CONFIG__='+JSON.stringify(cfg)+';</script><script type="module">'+script.replaceAll('</script','<\\/script')+'</script></body>');
await mkdir('release',{recursive:true});await writeFile('release/PETAVU-preview.html',html);
console.log('Standalone, embedded preview:',html.length,'characters. Offline demo only; no real account/API connection.');
