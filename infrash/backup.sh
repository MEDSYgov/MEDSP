#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.bash"
load_config
install_traps
operation_lock
CURRENT_STEP=backup-preflight
preflight
[[ "$(state_get build_status)" == complete ]] || die 'A completed build is required before backup.'
[[ ! -f "$DEPLOY_ROOT/deployment-incomplete" ]] || die 'Resolve the earlier incomplete deployment first.'
[[ "$(state_get backup_status)" != complete ]] || die 'This run already has a backup.'
(( ${#SUPABASE_CONFIG_FILES[@]} >= 1 )) || die 'List the real Supabase Compose/configuration files in SUPABASE_CONFIG_FILES.'
for file in "${SUPABASE_CONFIG_FILES[@]}"; do [[ -f "$file" && -r "$file" ]] || die "A configured Supabase settings file is unreadable: $file"; done

# One retention lock covers creation AND pruning across main and staging.
exec 8>"$BACKUP_ROOT/.infrash-retention.lock"
flock -w 600 8 || die 'Another backup is still running.'
backup_id="$(date -u +%Y%m%dT%H%M%S%6NZ)_${TARGET_BRANCH}_${INFRASH_RUN_ID}"
temporary="$(mktemp -d "$BACKUP_ROOT/.partial-${backup_id}-XXXXXX")"
cleanup_partial() {
    if [[ -n "${temporary:-}" && -d "$temporary" ]]; then
        python3 - "$BACKUP_ROOT" "$temporary" <<'PY'
import pathlib, shutil, sys
root=pathlib.Path(sys.argv[1]).resolve(); p=pathlib.Path(sys.argv[2])
if p.parent.resolve()!=root or not p.name.startswith('.partial-') or p.is_symlink():
    raise SystemExit('Refusing an unsafe partial-backup cleanup.')
shutil.rmtree(p)
PY
    fi
}
trap cleanup_partial EXIT
state_set backup_status running

CURRENT_STEP=backup-project
previous=''
old_container=''
old_image=''
if [[ -L "$DEPLOY_ROOT/current" ]]; then
    previous="$(readlink -f "$DEPLOY_ROOT/current")"
    [[ "$previous" == "$DEPLOY_ROOT/releases/"* && -f "$previous/release.json" ]] || die 'Invalid current release pointer.'
    old_container="$(container_for_release "$previous")"
    [[ -n "$old_container" ]] || die 'Current application container is missing; reconcile deployment before backing it up.'
    old_image="$(docker inspect --type container --format '{{.Image}}' "$old_container")"
    [[ "$old_image" == "$(release_get "$previous" image_id)" ]] || die 'Running image differs from the current release; reconcile first.'
    tar -C "$previous" -czf "$temporary/project.tar.gz" .
elif [[ "$BOOTSTRAP_EMPTY" == true ]]; then
    [[ -z "$INITIAL_CONTAINER" && -z "$INITIAL_PROJECT_DIR" ]] || die 'Empty bootstrap must not name an existing application.'
    [[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$APP_PROJECT")" ]] || die 'An application with this Compose project already exists.'
    printf '%s\n' 'New environment: there was no previously deployed application.' > "$temporary/no-previous-project.txt"
else
    [[ -d "$INITIAL_PROJECT_DIR" && -n "$INITIAL_CONTAINER" ]] || die 'Set INITIAL_PROJECT_DIR and INITIAL_CONTAINER for the existing installation.'
    python3 - "$INITIAL_PROJECT_DIR" "$BACKUP_ROOT" "$DEPLOY_ROOT" <<'PY'
import pathlib, sys
source, backup, deploy=map(lambda x:pathlib.Path(x).resolve(),sys.argv[1:])
if source == pathlib.Path('/') or backup.is_relative_to(source) or deploy.is_relative_to(source):
    raise SystemExit('Initial project directory must not contain deployment/backup roots.')
PY
    old_container="$INITIAL_CONTAINER"
    [[ "$old_container" != "$DB_CONTAINER" ]] || die 'INITIAL_CONTAINER must be the application, not the database.'
    old_project="$(docker inspect --type container --format '{{index .Config.Labels "com.docker.compose.project"}}' "$old_container")"
    [[ "$old_project" != "$APP_PROJECT" ]] || die 'First-time takeover must use a NEW Compose project name so the old container remains available.'
    old_image="$(docker inspect --type container --format '{{.Image}}' "$old_container")"
    tar --exclude='./node_modules' --exclude='./.git' -C "$INITIAL_PROJECT_DIR" -czf "$temporary/project.tar.gz" .
fi
state_set previous_release "$previous"
state_set previous_container "$old_container"
state_set previous_image "$old_image"
if [[ -n "$old_container" ]]; then
    docker inspect "$old_container" > "$temporary/container-inspect.private.json"
    docker image save "$old_image" | gzip -1 > "$temporary/application-image.tar.gz"
    gzip -t "$temporary/application-image.tar.gz"
fi
[[ ! -f "$temporary/project.tar.gz" ]] || tar -tzf "$temporary/project.tar.gz" >/dev/null

CURRENT_STEP=backup-database
say 'Creating a full logical backup with the PostgreSQL tools inside the database container.'
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom \
    > "$temporary/database.dump" 2>"$RUN_DIR/pg-dump.private.log"
[[ -s "$temporary/database.dump" ]] || die 'The database dump is empty.'
docker exec -i "$DB_CONTAINER" pg_restore --list < "$temporary/database.dump" > "$temporary/database.toc"
docker exec "$DB_CONTAINER" pg_dumpall -U "$DB_USER" --globals-only \
    > "$temporary/globals.sql" 2>"$RUN_DIR/pg-globals.private.log"
[[ -s "$temporary/globals.sql" ]] || die 'The PostgreSQL globals backup is empty.'
db_query 'SELECT version();' > "$temporary/database-version.txt"
docker inspect --format '{{.Config.Image}} {{.Image}}' "$DB_CONTAINER" > "$temporary/database-image.txt"

CURRENT_STEP=backup-configuration
install -m 600 "$INFRASH_CONFIG" "$temporary/deployment.conf"
install -m 600 "$APP_ENV_FILE" "$temporary/application.env"
tar -czf "$temporary/supabase-settings.tar.gz" -- "${SUPABASE_CONFIG_FILES[@]}" 2>"$RUN_DIR/settings-tar.private.log"
# Includes PostgreSQL custom config and the persistent pgsodium/Vault key where present.
docker cp "$DB_CONTAINER:$DB_CONFIG_PATH" "$temporary/postgresql-custom" > /dev/null

CURRENT_STEP=backup-storage
case "$SUPABASE_STORAGE_MODE" in
    filesystem)
        # Docker reads storage without requiring host-wide sudo for the Jenkins agent.
        docker run --rm --pull=never --network none --read-only --user 0 \
            --mount "type=bind,src=$SUPABASE_STORAGE_PATH,dst=/backup-source,readonly" \
            --entrypoint tar "$(state_get image)" -czf - -C /backup-source . \
            > "$temporary/storage-files.tar.gz"
        tar -tzf "$temporary/storage-files.tar.gz" >/dev/null
        ;;
    unused) printf '%s\n' 'Operator declares there are no external Storage objects to copy.' > "$temporary/storage-note.txt" ;;
    external) printf '%s\n' 'External object storage is not copied by this backup. Use its separate versioned backup/snapshot policy.' > "$temporary/storage-note.txt" ;;
esac

CURRENT_STEP=backup-complete
python3 - "$temporary" "$TARGET_BRANCH" "$INFRASH_RUN_ID" "$previous" "$old_image" "$SUPABASE_STORAGE_MODE" <<'PY'
import datetime, hashlib, json, pathlib, sys
root=pathlib.Path(sys.argv[1]); branch,run,previous,image,storage=sys.argv[2:]
manifest={'project':'MEDSP','format':1,'complete':True,'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'branch':branch,'run_id':run,'previous_release':previous,'image_id':image,'storage_mode':storage,
          'database_consistency':'pg_dump snapshot; filesystem/S3 is a separate consistency boundary'}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
with (root/'SHA256SUMS').open('w') as out:
    for p in sorted(root.rglob('*')):
        if not p.is_file() or p.is_symlink() or p.name=='SHA256SUMS': continue
        h=hashlib.sha256()
        with p.open('rb') as f:
            for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
        out.write(f'{h.hexdigest()}  {p.relative_to(root)}\n')
(root/'.infrash-complete').write_text('MEDSP\n')
PY
chmod -R go-rwx "$temporary"
final="$BACKUP_ROOT/$backup_id"
mv -- "$temporary" "$final"
temporary=''
state_set backup_path "$final"
state_set backup_status complete
export_report

# Keep the newest TEN COMPLETE managed backups in total, across both branches.
# Unknown files, symlinks and incomplete backups are never selected for deletion.
python3 - "$BACKUP_ROOT" "$KEEP_BACKUPS" <<'PY'
import json, pathlib, re, shutil, sys
root=pathlib.Path(sys.argv[1]).resolve(); keep=int(sys.argv[2]); items=[]
for p in root.iterdir():
    if p.is_symlink() or not p.is_dir() or not re.fullmatch(r'\d{8}T\d{12}Z_(main|staging)_[A-Za-z0-9._-]+',p.name): continue
    if not (p/'.infrash-complete').is_file(): continue
    try: m=json.loads((p/'manifest.json').read_text())
    except (OSError,ValueError): continue
    if isinstance(m,dict) and m.get('project')=='MEDSP' and m.get('complete') is True: items.append(p)
for p in sorted(items, key=lambda p:p.name, reverse=True)[keep:]:
    if p.parent.resolve()!=root: raise SystemExit('Unsafe retention path.')
    shutil.rmtree(p)
print(f'[infrash] Backup retention: {min(len(items),keep)} complete backups retained.')
PY
say "Backup ready: $final"
