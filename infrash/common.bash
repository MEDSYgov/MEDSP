# Shared functions, sourced by the four Bash entry points. Not an entry point.
set -Eeuo pipefail
umask 077

INFRASH_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd -- "$INFRASH_DIR/.." && pwd)"
CURRENT_STEP=initialization

say() { printf '[infrash] %s\n' "$*"; }
die() { say "ERROR: $*" >&2; return 1; }
need() { command -v "$1" >/dev/null || die "Required command is missing: $1"; }

load_config() {
    : "${INFRASH_CONFIG:?Set INFRASH_CONFIG to /etc/medsp/main.conf or staging.conf}"
    [[ "$INFRASH_CONFIG" == /* && -f "$INFRASH_CONFIG" ]] || die 'Config must be an absolute existing file.'
    python3 - "$INFRASH_CONFIG" <<'PY'
import os, stat, sys
p = sys.argv[1]; s = os.stat(p)
if s.st_mode & 0o022 or s.st_uid not in (0, os.getuid()):
    raise SystemExit('Config must be owned by root/current user and not group/world writable.')
PY
    # This is an administrator-owned Bash configuration, never a repository .env.
    # shellcheck disable=SC1090
    source "$INFRASH_CONFIG"
    : "${TARGET_BRANCH:?}" "${DEPLOY_ROOT:?}" "${BACKUP_ROOT:?}" "${APP_ENV_FILE:?}"
    : "${APP_PROJECT:?}" "${APP_PORT:?}" "${DB_CONTAINER:?}" "${DB_NAME:?}" "${DB_USER:?}"
    [[ "$TARGET_BRANCH" == main || "$TARGET_BRANCH" == staging ]] || die 'Only main and staging are supported.'
    [[ "${BRANCH_NAME:-$TARGET_BRANCH}" == "$TARGET_BRANCH" ]] || die 'Branch/config mismatch.'
    [[ -z "${CHANGE_ID:-}" ]] || die 'Pull request deployment is forbidden.'
    for p in "$DEPLOY_ROOT" "$BACKUP_ROOT" "$APP_ENV_FILE"; do
        [[ "$p" == /* && "$p" != / && "$p" != /home && "$p" != /tmp && "$p" != *$'\n'* ]] || die 'Use explicit absolute deployment paths.'
    done
    [[ "$APP_PROJECT" =~ ^[a-z0-9][a-z0-9_-]+$ ]] || die 'Invalid Compose project name.'
    [[ "$APP_PORT" =~ ^[0-9]+$ ]] && ((APP_PORT > 0 && APP_PORT < 65536)) || die 'Invalid app port.'
    APP_BIND_IP="${APP_BIND_IP:-127.0.0.1}"
    WAIT_SECONDS="${WAIT_SECONDS:-180}"
    KEEP_BACKUPS=10
    MIN_FREE_GIB="${MIN_FREE_GIB:-10}"
    BOOTSTRAP_EMPTY="${BOOTSTRAP_EMPTY:-false}"
    INITIAL_CONTAINER="${INITIAL_CONTAINER:-}"
    INITIAL_PROJECT_DIR="${INITIAL_PROJECT_DIR:-}"
    DB_CONFIG_PATH="${DB_CONFIG_PATH:-/etc/postgresql-custom}"
    PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-}"
    MIGRATIONS_BACKWARD_COMPATIBLE="${MIGRATIONS_BACKWARD_COMPATIBLE:-false}"
    declare -p SUPABASE_CONFIG_FILES >/dev/null 2>&1 || SUPABASE_CONFIG_FILES=()
    : "${SUPABASE_STORAGE_MODE:?Choose unused, filesystem or external explicitly}"
    case "$SUPABASE_STORAGE_MODE" in unused|filesystem|external) ;; *) die 'Invalid storage mode.' ;; esac
    [[ "$SUPABASE_STORAGE_MODE" != filesystem || -d "${SUPABASE_STORAGE_PATH:-}" ]] || die 'Set the existing storage directory.'
    [[ -n "${INFRASH_RUN_ID:-}" && "$INFRASH_RUN_ID" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{1,100}$ ]] || die 'Set a safe, unique INFRASH_RUN_ID.'
    RUN_DIR="$DEPLOY_ROOT/runs/$INFRASH_RUN_ID"
    RELEASE_DIR="$DEPLOY_ROOT/releases/$INFRASH_RUN_ID"
    STATE_FILE="$RUN_DIR/state.json"
    mkdir -p -- "$DEPLOY_ROOT/runs" "$DEPLOY_ROOT/releases" "$RUN_DIR" "$BACKUP_ROOT"
    chmod 700 "$DEPLOY_ROOT" "$BACKUP_ROOT" "$RUN_DIR"
    [[ "$(realpath -m "$DEPLOY_ROOT")" != "$(realpath -m "$BACKUP_ROOT")" ]] || die 'Deployment and backup roots must be different.'
}

state_set() {
    python3 - "$STATE_FILE" "$1" "$2" <<'PY'
import json, os, sys, tempfile
p, key, value = sys.argv[1:]
try:
    with open(p, encoding='utf-8') as f: data = json.load(f)
except FileNotFoundError: data = {}
data[key] = value
fd, temp = tempfile.mkstemp(dir=os.path.dirname(p), prefix='.state-')
with os.fdopen(fd, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2); f.write('\n')
os.replace(temp, p)
PY
}

json_get() {
    python3 - "$1" "$2" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as f: v = json.load(f).get(sys.argv[2], '')
except FileNotFoundError: v = ''
print(v if v is not None else '')
PY
}
state_get() { json_get "$STATE_FILE" "$1"; }

export_report() {
    [[ -f "${STATE_FILE:-}" ]] || return 0
    # No credentials, SQL stderr, container inspection or environment files are archived.
    python3 - "$STATE_FILE" "$SOURCE_DIR/.infrash-report.json" <<'PY'
import json, sys
keys = ('branch','commit','run_id','started_at','status','image','backup_path','backup_status',
        'migration_status','migration_count','verification_status','rollback_status','error_summary','release_dir')
with open(sys.argv[1], encoding='utf-8') as f: d=json.load(f)
with open(sys.argv[2], 'w', encoding='utf-8') as f: json.dump({k:d[k] for k in keys if k in d}, f, ensure_ascii=False, indent=2)
PY
}

failed() {
    local rc="$1" line="$2"
    trap - ERR INT TERM
    if [[ -n "${STATE_FILE:-}" && -d "${RUN_DIR:-/nonexistent}" ]]; then
        state_set error_summary "${CURRENT_STEP} failed (exit ${rc}, line ${line}). Inspect the Jenkins console and private server diagnostics."
        state_set status FAILURE
        export_report || true
    fi
    say "FAILED: ${CURRENT_STEP}; exit=${rc}." >&2
    exit "$rc"
}
install_traps() {
    trap 'failed "$?" "$LINENO"' ERR
    trap 'failed 130 "$LINENO"' INT
    trap 'failed 143 "$LINENO"' TERM
}

operation_lock() {
    exec 9>"$DEPLOY_ROOT/.operation.lock"
    flock -w 30 9 || die 'Another local operation is still running.'
}

preflight() {
    for tool in docker python3 tar gzip sha256sum flock; do need "$tool"; done
    docker info >/dev/null 2>"$RUN_DIR/docker-info.private.log" || die 'Docker daemon is unavailable to the agent.'
    docker compose version --short | python3 -c 'import re,sys; v=re.search(r"(\d+)\.(\d+)",sys.stdin.read()); sys.exit(0 if v and tuple(map(int,v.groups())) >= (2,20) else "Docker Compose 2.20+ is required.")'
    [[ -r "$APP_ENV_FILE" ]] || die 'Application environment file is unreadable.'
    python3 - "$APP_ENV_FILE" "$DEPLOY_ROOT" "$BACKUP_ROOT" "$MIN_FREE_GIB" <<'PY'
import os, shutil, sys
p, deploy, backup, gib=sys.argv[1:]
if os.stat(p).st_mode & 0o077: raise SystemExit('The application .env must have mode 0600.')
for root in (deploy, backup):
    if shutil.disk_usage(root).free < int(gib)*1024**3: raise SystemExit('Insufficient free space; check MIN_FREE_GIB and backup/image sizes.')
PY
    [[ "$(docker inspect --format '{{.State.Running}}' "$DB_CONTAINER")" == true ]] || die 'The configured database container is not running.'
    [[ "$(db_query 'SHOW server_version_num;')" =~ ^17[0-9]{4}$ ]] || die 'This configuration expects PostgreSQL 17.'
    # A killed docker-exec client can leave a backend running. Do not race it.
    [[ "$(db_query "SELECT count(*) FROM pg_stat_activity WHERE application_name='medsp-infrash-migrate' AND state <> 'idle';")" == 0 ]] || die 'An earlier migration session still runs; inspect it before retrying.'
}

db_query() {
    docker exec -i "$DB_CONTAINER" psql -X -qAt -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -c "$1"
}

release_get() { json_get "$1/release.json" "$2"; }

compose_release() {
    local release="$1"; shift
    local image project port bind
    image="$(release_get "$release" image)"
    project="$(release_get "$release" project)"
    port="$(release_get "$release" port)"
    bind="$(release_get "$release" bind)"
    APP_IMAGE="$image" MEDSP_RUNTIME_ENV="$release/runtime.env" MEDSP_BIND_IP="$bind" MEDSP_HOST_PORT="$port" \
        docker compose --project-name "$project" --project-directory "$release/source" \
        --env-file /dev/null -f "$release/source/infrash/compose.app.yml" "$@"
}

container_for_release() { compose_release "$1" ps -aq medsp; }

atomic_link() {
    local target="$1" link="$2"
    python3 - "$target" "$link" <<'PY'
import os, sys, uuid
target, link=sys.argv[1:]; tmp=link+'.tmp-'+uuid.uuid4().hex
os.symlink(target, tmp); os.replace(tmp, link)
PY
}

migration_command() {
    local mode="$1"; shift
    python3 "$INFRASH_DIR/migrations.py" "$mode" \
        --directory "$RELEASE_DIR/source/supabase/migrations" \
        --container "$DB_CONTAINER" --database "$DB_NAME" --username "$DB_USER" \
        --environment "$TARGET_BRANCH" --commit "$(state_get commit)" \
        --report "$RUN_DIR/migrations.json" "$@"
}
