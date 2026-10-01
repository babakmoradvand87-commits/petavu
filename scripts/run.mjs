if(process.env.APP_SCOPE==='public')await import('./serve-public.mjs');else await import('./serve.mjs');
