/** Public launch server. There is no SPA fallback or route to any panel/API/source file. */
import http from 'node:http';
import path from 'node:path';
import {realpath,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {brotliCompressSync,gzipSync,constants} from 'node:zlib';
const root=await realpath(process.env.STATIC_DIR||path.resolve('dist/public'));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
const allowed=u=>/^\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(u)||/^\/fonts\/(?:Vazirmatn|Manrope)(?:\.woff2|-LICENSE\.txt)$/.test(u)||/^\/brand\/petavu-(?:mark|logo)\.svg$/.test(u)||u==='/images/petavu-ecosystem.webp';
const cache=new Map();
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 // Embedding is allowed for this non-interactive public marketing page only, to support its preview.
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors *");
 if(process.env.HTTPS_AT_EDGE==='true')res.setHeader('Strict-Transport-Security','max-age=31536000');
 if(!['GET','HEAD'].includes(req.method||'')){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
 let u;try{u=decodeURIComponent(new URL(req.url,'http://server.invalid').pathname)}catch{res.writeHead(400);res.end();return;}
 if(u.includes('\0')||u.includes('\\')){res.writeHead(400);res.end();return;}
 if(u==='/healthz'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({status:'ok',surface:'coming-soon-only',databaseConnected:false}));return;}
 const isIndex=u==='/'||u==='/index.html';if(!isIndex&&!allowed(u)){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('صفحه‌ای با این نشانی وجود ندارد.');return;}
 const file=path.resolve(root,isIndex?'index.html':'.'+u);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{
  const resolved=await realpath(file);if(!resolved.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  let cached=cache.get(resolved);if(!cached){const raw=await readFile(resolved);cached={raw,etag:'"'+createHash('sha256').update(raw).digest('hex')+'"'};if(['.js','.css','.html','.svg'].includes(path.extname(file))&&raw.length>512){cached.br=brotliCompressSync(raw,{params:{[constants.BROTLI_PARAM_QUALITY]:5}});cached.gzip=gzipSync(raw)}cache.set(resolved,cached)}
  const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':u.startsWith('/assets/')?'public, max-age=31536000, immutable':isIndex?'no-cache':'public, max-age=86400','ETag':cached.etag,'Vary':'Accept-Encoding'};
  if(req.headers['if-none-match']===cached.etag){res.writeHead(304,headers);res.end();return;}
  let data=cached.raw;const accept=req.headers['accept-encoding']||'';if(cached.br&&accept.includes('br')){data=cached.br;headers['Content-Encoding']='br'}else if(cached.gzip&&accept.includes('gzip')){data=cached.gzip;headers['Content-Encoding']='gzip'}
  headers['Content-Length']=data.length;res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404);res.end();}
});
server.listen(Number(process.env.PORT||5173),'0.0.0.0',()=>{console.log('PETAVU public launch page is live. Panel, admin, API, database and source routes are not exposed.');const id=process.env.E2B_SANDBOX_ID;if(id&&/^[a-z0-9]+$/i.test(id))console.log(`Protected preview URL (not anonymous public hosting): https://${process.env.PORT||5173}-${id}.e2b.app/`)});
