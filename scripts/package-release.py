#!/usr/bin/env python3
"""Package a secret-free source release and the already-built offline UI preview.
Not a production database/Storage backup. Run export:preview before this script.
"""
from pathlib import Path
import os,zipfile,hashlib,json,re,shutil
root=Path(__file__).resolve().parents[1];release=root/'release';release.mkdir(exist_ok=True)
assert (release/'PETAVU-preview.html').is_file(),'Run npm run export:preview first'
excluded={'node_modules','dist','release','design-history','.git','test-results','playwright-report','backups','secrets','credentials','__pycache__'}
paths=[]
for base,dirs,files in os.walk(root):
 dirs[:]=[d for d in dirs if d not in excluded]
 for name in files:
  p=Path(base)/name;rel=p.relative_to(root)
  if name.startswith('.env') and name!='.env.example':raise SystemExit('Unexpected environment file in source')
  if rel.parts[0]=='assets' and p.suffix=='.png':continue
  if p.suffix in {'.pem','.key','.dump','.backup','.log'}:raise SystemExit('Unexpected credential/data artifact')
  if p.suffix in {'.md','.ts','.tsx','.json','.js','.mjs','.py','.sh','.yml','.yaml','.example'}:
   text=p.read_text(encoding='utf-8',errors='ignore')
   if re.search(r'(?:ghp_|github_pat_|sbp_|sb_secret_)[A-Za-z0-9_]{20,}',text):raise SystemExit('Potential credential found; refusing package')
  paths.append(p)
archive=release/'PETAVU-source.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(paths):z.write(p,'PETAVU/'+str(p.relative_to(root)))
 z.write(release/'PETAVU-preview.html','PETAVU/release/PETAVU-preview.html')
 assert z.testzip() is None
shutil.copyfile(root/'public/brand/petavu-logo.svg',release/'PETAVU-logo.svg')
entries=[]
for p in [archive,release/'PETAVU-preview.html',release/'PETAVU-logo.svg']:
 entries.append({'path':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(release/'manifest.json').write_text(json.dumps({'format':'petavu-release-v1','version':'0.2.0','contains_production_data':False,'contains_account_credentials':False,'files':entries},indent=2))
(release/'checksums.sha256').write_text(''.join(f"{e['sha256']}  {e['path']}\n" for e in entries))
print('Source files:',len(paths))
print('Best-effort credential-pattern scan: clear. Review is still required before real deployments.')
for e in entries:print(e['path'],round(e['bytes']/1024),'KiB')
