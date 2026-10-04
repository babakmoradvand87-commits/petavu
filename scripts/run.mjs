// Runtime همان DB/API/Web/Worker؛ این اسکریپت مهاجرت یا دادهٔ نمونه تولید نمی‌کند.
import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {openDatabase} from './lib/engine.mjs';import {createEmbeddedClient} from './lib/embedded-client.mjs';
import {createPostgresClient} from '../packages/db/dist/index.js';import {loadEnv,createLogger} from '../packages/shared/dist/index.js';
import {createApiServer} from '../apps/api/dist/index.js';import {createWebServer} from '../apps/web/dist/index.js';import {createWorker} from '../apps/worker/dist/index.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),mode=process.argv.includes('--worker')?'worker':process.argv.includes('--api')?'api':process.argv.includes('--web')?'web':'all';
const env=loadEnv({...process.env,DATABASE_URL:process.env.DATABASE_URL??process.env.PETAVU_DATABASE_URL??''}),logger=createLogger({level:env.logLevel});
let engine=null;const client=env.database.url?await createPostgresClient({url:env.database.url,poolMax:env.database.poolMax,statementTimeoutMs:env.database.statementTimeoutMs}):createEmbeddedClient(engine=await openDatabase({dataDir:process.env.PETAVU_DATA_DIR??join(root,'.data/pg')}));
let api=null,web=null,worker=null;
try{if(mode==='all'||mode==='api'){api=createApiServer({client,env,logger});await api.listen(env.apiPort,env.http.host);logger.info('API',{port:env.apiPort});}
 if(mode==='all'||mode==='web'||mode==='worker'){web=createWebServer({client,env,logger,assetsDirectory:join(root,'apps/web/assets'),apiOrigin:process.env.INTERNAL_API_ORIGIN??`http://127.0.0.1:${env.apiPort}`});if(mode!=='worker'){await web.listen(env.http.port,env.http.host);logger.info('Website',{port:env.http.port,surfaces:Object.values(env.origins)});}}
 if(mode==='all'||mode==='worker'){worker=createWorker({client,env,logger,render:async path=>web.render({method:'GET',url:path,host:new URL(env.origins.public).host})});void worker.run().catch(error=>{logger.error('Worker متوقف شد',{error:error.message});process.exitCode=1;});logger.info('Worker',{workerId:worker.workerId});}
 const shutdown=async()=>{worker?.stop();await web?.close();await api?.close();await client.close();};process.once('SIGINT',()=>void shutdown().then(()=>process.exit(0)));process.once('SIGTERM',()=>void shutdown().then(()=>process.exit(0)));
}catch(error){logger.error('شروع ناموفق',{error:error.message});await client.close();process.exitCode=1;}
