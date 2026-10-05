/** SBOM از lockfile واقعی؛ ادعا بدون فایل ساخته نمی‌شود (§117). */
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const components = [];
function walk(name, node) {
  if (!node || typeof node !== 'object') return;
  if (node.version) components.push({name, version: node.version, integrity: node.integrity ?? null, dev: Boolean(node.dev)});
  if (node.packages) for (const [k, v] of Object.entries(node.packages)) walk(k || lock.name, v);
  if (node.dependencies) for (const [k, v] of Object.entries(node.dependencies)) walk(k, v);
}
walk(lock.name, lock);
const unique = [...new Map(components.map((c) => [`${c.name}@${c.version}`, c])).values()].sort((a, b) => a.name.localeCompare(b.name));
const doc = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: 'urn:uuid:' + createHash('sha256').update(JSON.stringify(unique)).digest('hex').slice(0, 32),
  metadata: {timestamp: new Date().toISOString(), component: {name: 'petavu', version: lock.version}},
  components: unique.map((c) => ({type: 'library', name: c.name, version: c.version, hashes: c.integrity ? [{alg: 'SHA-512', content: c.integrity}] : [], properties: [{name: 'dev', value: String(c.dev)}]})),
};
const dir = join(root, 'quality/evidence');
await mkdir(dir, {recursive: true});
await writeFile(join(dir, 'sbom.json'), JSON.stringify(doc, null, 2));
console.log(JSON.stringify({components: unique.length, path: 'quality/evidence/sbom.json'}));
