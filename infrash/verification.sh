#!/usr/bin/env bash
set -Eeuo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mode="${1:-check}"

if [[ "$mode" == notify ]]; then
    # Installed at /opt/medsp-ci with common.bash and notify.py, so SCM failure
    # does not remove the notifier. It tolerates missing/invalid run setup.
    set +x
    state=''
    if [[ -n "${INFRASH_CONFIG:-}" && -n "${INFRASH_RUN_ID:-}" ]]; then
        state="$(bash -c '
            source "$1/common.bash"
            load_config >/dev/null
            printf "%s" "$STATE_FILE"
        ' bash "$script_dir")" || state=''
    fi
    if [[ -n "$state" ]]; then
        exec python3 "$script_dir/notify.py" --state "$state"
    fi
    exec python3 "$script_dir/notify.py"
fi
[[ "$mode" == check ]] || { printf 'Usage: verification.sh check|notify\n' >&2; exit 2; }
source "$script_dir/common.bash"
load_config
install_traps
operation_lock

verification_failed() {
    local rc="$1"
    trap - ERR INT TERM
    state_set status FAILURE
    state_set verification_status failed
    state_set error_summary "Verification failed during ${CURRENT_STEP}. See the Jenkins job and private verification diagnostics."
    export_report
    # Release the local lock before invoking the separate rollback entry point.
    flock -u 9
    if ! bash "$script_dir/deploy.sh" rollback; then
        state_set rollback_status failed
        export_report
    fi
    exit "$rc"
}
trap 'verification_failed "$?"' ERR
CURRENT_STEP=verify-container
[[ "$(state_get deployment_status)" == activated ]] || die 'The application has not been activated for this run.'
state_set verification_status running
container="$(container_for_release "$RELEASE_DIR")"
[[ -n "$container" ]] || die 'Application container is missing.'
[[ "$(docker inspect --format '{{.Image}}' "$container")" == "$(state_get image_id)" ]] || die 'The running container is not the image built by this run.'
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" == healthy ]] || die 'Container health check is not healthy.'

CURRENT_STEP=verify-application-and-supabase
# Retry readiness briefly; each Node request has its own strict timeout.
for attempt in {1..6}; do
    if docker exec -i "$container" node --input-type=module \
        < "$RELEASE_DIR/source/infrash/probe.mjs" > "$RUN_DIR/verification.private.log" 2>&1; then
        break
    fi
    ((attempt < 6)) || die 'Application or Supabase readiness probe failed; see verification.private.log.'
    sleep 3
done

CURRENT_STEP=verify-database-history
db_query 'SELECT 1;' >/dev/null
docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    < "$RELEASE_DIR/source/infrash/schema-check.sql" > "$RUN_DIR/schema-check.private.log" 2>&1
python3 "$INFRASH_DIR/migrations.py" inventory --directory "$RELEASE_DIR/source/supabase/migrations" > "$RUN_DIR/expected-history.tsv"
db_query "SELECT version || E'\t' || filename || E'\t' || sha256 FROM infrash.schema_migrations ORDER BY version;" > "$RUN_DIR/database-history.tsv"
cmp -s "$RUN_DIR/expected-history.tsv" "$RUN_DIR/database-history.tsv" || die 'Migration history does not match the deployed commit.'
[[ "$(db_query 'SELECT environment FROM infrash.deployment_target WHERE singleton;')" == "$TARGET_BRANCH" ]] || die 'Database environment marker mismatch.'

CURRENT_STEP=verify-host-http
python3 - "$APP_BIND_IP" "$APP_PORT" "$PUBLIC_HEALTH_URL" <<'PY'
import sys, time, urllib.request
bind,port,external=sys.argv[1:]
host='127.0.0.1' if bind=='0.0.0.0' else bind
urls=[f'http://{host}:{port}/healthz'] + ([external] if external else [])
for i,url in enumerate(urls):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url,timeout=10) as r:
                if r.status!=200 or r.read(4096).strip()!=b'ok': raise ValueError('Unexpected response')
            break
        except Exception:
            if attempt==2: raise SystemExit(f'Host/public health endpoint #{i+1} failed.')
            time.sleep(2)
print('PASS: host port' + (' and configured public health endpoint.' if external else '.'))
PY

CURRENT_STEP=verification-complete
atomic_link "$RELEASE_DIR" "$DEPLOY_ROOT/last-successful"
state_set verification_status passed
state_set status SUCCESS
state_set error_summary ''
if [[ -f "$DEPLOY_ROOT/deployment-incomplete" && "$(cat "$DEPLOY_ROOT/deployment-incomplete")" == "$INFRASH_RUN_ID" ]]; then
    rm -- "$DEPLOY_ROOT/deployment-incomplete"
fi
export_report
say 'Verification passed. Jenkins post action sends the final Discord report.'
