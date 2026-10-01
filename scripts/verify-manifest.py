#!/usr/bin/env python3
"""Verify a restored backup manifest; never modifies or restores a database."""
import argparse,hashlib,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('directory');args=p.parse_args()
root=Path(args.directory).resolve();manifest=json.loads((root/'manifest.json').read_text())
assert manifest.get('format')=='petavu-backup-v1','Unknown manifest format'
seen=set()
for entry in manifest['files']:
 name=entry['path'];assert name not in seen,'Duplicate path';seen.add(name)
 f=(root/name).resolve();assert f.is_relative_to(root) and f.is_file(),'Invalid/missing path'
 assert f.stat().st_size==entry['bytes'],f'Size mismatch: {name}'
 h=hashlib.sha256()
 with f.open('rb') as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
 assert h.hexdigest()==entry['sha256'],f'Checksum mismatch: {name}'
print(f'PASS: {len(seen)} files match their manifest. This does not prove database/Auth application restore.')
