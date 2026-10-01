#!/usr/bin/env bash
# Operator-run scaffold. It does not activate a scheduler or freeze application writes.
set -euo pipefail
umask 077
if [[ "${1:-}" == "--help" ]]; then
  printf '%s\n' 'PETAVU backup: requires PGSERVICE, PGPASSFILE, RESTIC_REPOSITORY, RESTIC_PASSWORD_FILE, OBJECTS_SOURCE, SOURCE_RELEASE_ARCHIVE, CONFIG_EXPORT_DIR, BACKUP_WORKDIR, PETAVU_WRITE_FREEZE_CONFIRMED=yes. See docs/BACKUP-RUNBOOK.fa.md. No credentials belong in shell history.'
  exit 0
fi
for tool in pg_dump rclone restic python3; do command -v "$tool" >/dev/null || { printf 'Missing required tool: %s\n' "$tool" >&2; exit 1; }; done
: "${PGSERVICE:?Use a securely provisioned pg_service.conf service}"
: "${PGPASSFILE:?Use a secret-mounted password file}"
: "${RESTIC_REPOSITORY:?Configure independent encrypted repository}"
: "${RESTIC_PASSWORD_FILE:?Use a secret-mounted restic key}"
: "${OBJECTS_SOURCE:?Configure reviewed rclone source}"
: "${SOURCE_RELEASE_ARCHIVE:?Supply a secret-free release archive}"
: "${CONFIG_EXPORT_DIR:?Supply reviewed configuration/Auth exports}"
: "${BACKUP_WORKDIR:?Use encrypted scratch storage outside the workspace}"
[[ "${PETAVU_WRITE_FREEZE_CONFIRMED:-no}" == yes ]] || { echo 'Refusing inconsistent backup: confirm an actual application/object write barrier first.' >&2; exit 1; }
[[ -r "$PGPASSFILE" && -r "$RESTIC_PASSWORD_FILE" && -s "$SOURCE_RELEASE_ARCHIVE" && -d "$CONFIG_EXPORT_DIR" ]] || { echo 'Missing secure inputs.' >&2; exit 1; }
export PGSERVICE PGPASSFILE RESTIC_REPOSITORY RESTIC_PASSWORD_FILE
scratch=$(mktemp -d "${BACKUP_WORKDIR%/}/petavu.XXXXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
mkdir -p "$scratch/objects" "$scratch/config"
# Full source recovery dump and a separate portable-domain export.
pg_dump --format=custom --no-owner --file="$scratch/database-full.dump"
pg_dump --format=custom --no-owner --no-acl --schema=identity --schema=network --schema=content --schema=commerce --schema=operations --file="$scratch/database-domain.dump"
rclone copy "$OBJECTS_SOURCE" "$scratch/objects" --checksum --quiet
cp -- "$SOURCE_RELEASE_ARCHIVE" "$scratch/source-release.archive"
cp -a -- "$CONFIG_EXPORT_DIR/." "$scratch/config/"
python3 - "$scratch" <<'PY'
import hashlib,json,sys,datetime
from pathlib import Path
root=Path(sys.argv[1]);files=[]
for p in sorted(root.rglob('*')):
 if p.is_symlink(): raise SystemExit('Refusing symlink in backup inputs')
 if p.is_file():
  h=hashlib.sha256()
  with p.open('rb') as f:
   for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
  files.append({'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':h.hexdigest()})
(root/'manifest.json').write_text(json.dumps({'format':'petavu-backup-v1','created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'write_barrier_confirmed_by_operator':True,'files':files},indent=2))
PY
restic backup "$scratch" --tag petavu --tag coordinated-snapshot --json >/dev/null
# Reads repository pack/header integrity; this is NOT a full application restore drill.
restic check --read-data-subset=5% >/dev/null
printf '%s\n' 'Snapshot captured and encrypted repository checked. Complete isolated restore drill before treating this backup as verified. No automatic pruning was performed.'
