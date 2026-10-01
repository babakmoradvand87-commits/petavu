/** Static app server only. Real BFF/auth endpoints are deliberately not implemented. */
import http from 'node:http';
import path from 'node:path';
import {realpath,stat,readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
const valid=['preview','web','panel','adminpanel','shop','adminshop'];
const scope=process.env.APP_SCOPE||'web';if(!valid.includes(scope))throw new Error('Invalid APP_SCOPE');
const root=await realpath(process.env.STATIC_DIR||path.resolve('dist',scope));
const mode=process.env.PETAVU_MODE==='demo'?'demo':'unconfigured';
const apiBase=process.env.PETAVU_API_BASE||'/api';
if(apiBase!=='/api')throw new Error('This scaffold supports same-origin /api only; configure a reviewed reverse proxy.');
const cfg={scope,mode,baseDomain:process.env.PETAVU_BASE_DOMAIN||'',apiBase,routing:'history'};
if(cfg.baseDomain&&!/^[a-z0-9.-]+$/i.test(cfg.baseDomain))throw new Error('Invalid public base domain');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; worker-src 'self' blob:";
const server=http.createServer(async(req,res)=>{
 res.setHeader('Content-Security-Policy',csp);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
 if(process.env.HTTPS_AT_EDGE==='true')res.setHeader('Strict-Transport-Security','max-age=31536000');
 if(!['GET','HEAD'].includes(req.method||'')){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
 let url;try{url=decodeURIComponent(new URL(req.url,'http://server.invalid').pathname)}catch{res.writeHead(400);res.end();return;}
 if(url.includes('\0')||url.includes('\\')){res.writeHead(400);res.end();return;}
 if(url==='/healthz'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({component:'static-ui',mode,backendConnected:false}));return;}
 if(url==='/runtime-config.js'){res.writeHead(200,{'Content-Type':mime['.js'],'Cache-Control':'no-store'});res.end('window.__PETAVU_CONFIG__ = '+JSON.stringify(cfg).replaceAll('<','\\u003c')+';');return;}
 if(url==='/api'||url.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'integration_not_configured',message:'No authentication/database backend is connected.'}));return;}
 const requested=path.resolve(root,'.'+url);if(requested!==root&&!requested.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 let file=requested;try{const s=await stat(file);if(!s.isFile())throw new Error()}catch{if(path.extname(url)){res.writeHead(404);res.end();return;}file=path.join(root,'index.html');}
 try{file=await realpath(file);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':url.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});if(req.method==='HEAD'){res.end();return;}createReadStream(file).pipe(res);}catch{res.writeHead(404);res.end();}
});
server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log(`PETAVU ${scope}: static UI ready; mode=${mode}; no backend connected.`));
