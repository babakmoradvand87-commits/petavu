#!/usr/bin/env python3
"""Build handoff artifact from the public entry only; never copies panel/source/API files."""
from pathlib import Path
import shutil,zipfile
root=Path(__file__).resolve().parents[1];public=root/'dist/public';out=root/'release/public-site'
if out.exists():shutil.rmtree(out)
out.mkdir(parents=True)
files=['index.html','fonts/Vazirmatn.woff2','fonts/Manrope.woff2','fonts/Vazirmatn-LICENSE.txt','fonts/Manrope-LICENSE.txt','brand/petavu-mark.svg','brand/petavu-logo.svg','images/petavu-ecosystem.webp']
files += [str(p.relative_to(public)) for p in (public/'assets').glob('*') if p.suffix in {'.js','.css'}]
for name in files:
 target=out/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(public/name,target)
(out/'.nojekyll').write_text('')
notices=[]
for package in ['react','react-dom','three','lucide-react']:
 base=root/'node_modules'/package
 license_file=next((base/name for name in ['LICENSE','LICENSE.txt','LICENSE.md'] if (base/name).exists()),None)
 if license_file is None:raise SystemExit('Missing license for '+package)
 notices.append(package+'\n'+'='*60+'\n'+license_file.read_text())
(out/'THIRD-PARTY-NOTICES.txt').write_text('\n\n'.join(notices))
for p in (out/'assets').glob('*.js'):
 text=p.read_text();assert '/adminpanel' not in text and '/panel/register' not in text and 'مجموعهٔ نمونهٔ پِتاو' not in text,'Private app content in public artifact'
with zipfile.ZipFile(root/'release/PETAVU-public-site.zip','w',zipfile.ZIP_DEFLATED) as z:
 for p in out.rglob('*'):
  if p.is_file():z.write(p,p.relative_to(out))
print('Public artifact prepared: launch only, self-hosted assets and required license notices; no private app or credential files.')
