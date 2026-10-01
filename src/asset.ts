/** Portable assets for a root domain, GitHub Pages subpath and the embedded offline preview. */
export function asset(path:string){if(/^(data:|https?:)/.test(path))return path;const base=import.meta.env.BASE_URL||'/';return base==='/'?path:base+path.replace(/^\/+/, '')}
