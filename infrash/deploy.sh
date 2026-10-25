#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.bash"
load_config
install_traps
operation_lock
mode="${1:-deploy}"
if (($#)); then shift; fi

clear_own_marker() {
    if [[ -f "$DEPLOY_ROOT/deployment-incomplete" && "$(cat "$DEPLOY_ROOT/deployment-incomplete")" == "$INFRASH_RUN_ID" ]]; then
        rm -- "$DEPLOY_ROOT/deployment-incomplete"
    fi
}

rollback_application() {
    CURRENT_STEP=application-rollback
    local count migration_status previous old_container marker_run current_release
    marker_run=''
    current_release=''
    [[ ! -f "$DEPLOY_ROOT/deployment-incomplete" ]] || marker_run="$(cat "$DEPLOY_ROOT/deployment-incomplete")"
    [[ -z "$marker_run" || "$marker_run" == "$INFRASH_RUN_ID" ]] || die 'A newer/different run owns the incomplete deployment; refusing stale recovery.'
    count="$(state_get migration_count)"
    migration_status="$(state_get migration_status)"
    if [[ "$migration_status" == unknown || "$migration_status" == running ]]; then
        state_set rollback_status manual_required
        say 'Database outcome is unknown; inspect migration sessions/history before recovery.'
        return 0
    fi
    if [[ "$(state_get activation_started)" != true ]]; then
        # If no database changes were committed, the old application is untouched.
        if [[ "$migration_status" == rolled_back || "$count" == 0 ]]; then
            state_set rollback_status not_needed
            clear_own_marker
        else
            state_set rollback_status manual_required
        fi
        return 0
    fi
    if [[ ! "$count" =~ ^[0-9]+$ ]]; then
        state_set rollback_status manual_required
        say 'Migration count is unknown; inspect database history before app recovery.'
        return 0
    fi
    # Compare decimal digits without shell arithmetic (no octal/overflow edge).
    if [[ ! "$count" =~ ^0+$ && "$MIGRATIONS_BACKWARD_COMPATIBLE" != true ]]; then
        state_set rollback_status manual_required
        say 'Application recovery needs review because committed schema changes may be incompatible.'
        return 0
    fi
    [[ ! -L "$DEPLOY_ROOT/current" ]] || current_release="$(readlink -f "$DEPLOY_ROOT/current")"
    previous="$(state_get previous_release)"
    if [[ -n "$marker_run" ]]; then
        [[ "$current_release" == "$RELEASE_DIR" || "$current_release" == "$previous" ]] || die 'Current release no longer belongs to this deployment; refusing stale recovery.'
    else
        [[ "$current_release" == "$RELEASE_DIR" ]] || die 'Only the currently active run can be rolled back.'
    fi
    [[ "$(db_query "SELECT count(*) FROM pg_stat_activity WHERE application_name='medsp-infrash-migrate' AND state <> 'idle';")" == 0 ]] || die 'A migration session is still running.'
    old_container="$(state_get previous_container)"
    if [[ -n "$previous" && -f "$previous/release.json" ]]; then
        compose_release "$previous" up --detach --no-build --pull never --wait --wait-timeout "$WAIT_SECONDS" medsp
        atomic_link "$previous" "$DEPLOY_ROOT/current"
    elif [[ -n "$old_container" ]]; then
        compose_release "$RELEASE_DIR" stop medsp
        docker start "$old_container" >/dev/null
        # The existing MEDSP image also provides Node and /healthz.
        for attempt in {1..12}; do
            if docker exec "$old_container" node -e "fetch('http://127.0.0.1:3000/healthz').then(async r=>{if(!r.ok||(await r.text()).trim()!=='ok')process.exit(1)}).catch(()=>process.exit(1))"; then break; fi
            ((attempt < 12)) || die 'Previous application failed its health check.'
            sleep 2
        done
        [[ ! -L "$DEPLOY_ROOT/current" ]] || rm -- "$DEPLOY_ROOT/current"
    else
        state_set rollback_status unavailable
        say 'No previous application exists; review the first deployment before retrying.'
        return 0
    fi
    state_set rollback_status restored
    clear_own_marker
    export_report
    say 'Previous application restored. The database was not restored from backup.'
}

if [[ "$mode" == rollback ]]; then
    rollback_application
    export_report
    exit 0
fi

[[ "$mode" == deploy || "$mode" == baseline ]] || die 'Usage: deploy.sh [deploy|rollback|baseline --manifest /absolute/reviewed.tsv --acknowledge-reviewed-schema]'
CURRENT_STEP=deploy-preflight
preflight
[[ "$(state_get build_status)" == complete && "$(state_get backup_status)" == complete ]] || die 'Completed build and backup are required.'
backup="$(state_get backup_path)"
[[ -f "$backup/.infrash-complete" && -s "$backup/database.dump" ]] || die 'The completed backup is missing.'
[[ ! -f "$DEPLOY_ROOT/deployment-incomplete" ]] || die 'An earlier incomplete deployment needs review.'
[[ "$(docker image inspect --format '{{.Id}}' "$(state_get image)")" == "$(state_get image_id)" ]] || die 'The candidate image tag changed after build.'
actual_previous=''
[[ ! -L "$DEPLOY_ROOT/current" ]] || actual_previous="$(readlink -f "$DEPLOY_ROOT/current")"
[[ "$actual_previous" == "$(state_get previous_release)" ]] || die 'The current release changed after this backup.'

if [[ "$mode" == baseline ]]; then
    CURRENT_STEP=database-baseline
    # This is an explicit one-time administrative action, never a Jenkins stage.
    migration_command baseline "$@"
    state_set migration_status baselined
    export_report
    say 'Reviewed baseline recorded. Start a fresh Jenkins build to deploy.'
    exit 0
fi

printf '%s\n' "$INFRASH_RUN_ID" > "$DEPLOY_ROOT/deployment-incomplete"
state_set migration_status running
state_set rollback_status not_attempted
CURRENT_STEP=database-migrations
if migration_command apply; then
    count="$(json_get "$RUN_DIR/migrations.json" applied)"
    state_set migration_count "$count"
    state_set migration_status complete
else
    outcome="$(json_get "$RUN_DIR/migrations.json" database_outcome)"
    code="$(json_get "$RUN_DIR/migrations.json" error_code)"
    if [[ "$outcome" == rolled_back || "$outcome" == not_started ]]; then
        state_set migration_status "$outcome"
        state_set migration_count 0
        clear_own_marker
    else
        state_set migration_status unknown
    fi
    state_set status FAILURE
    state_set error_summary "Database migration stopped: ${code:-MIGRATION_FAILED}. See private migration diagnostics on the application server."
    export_report
    exit 1
fi

CURRENT_STEP=database-schema-check
if ! docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    < "$RELEASE_DIR/source/infrash/schema-check.sql" > "$RUN_DIR/schema-check.private.log" 2>&1; then
    state_set status FAILURE
    state_set error_summary 'Required MEDSP tables/RPC signatures are missing; inspect schema-check.private.log. The previously deployed application was not replaced.'
    rollback_application
    export_report
    exit 1
fi

CURRENT_STEP=activate-application
state_set activation_started true
# First-time takeover leaves the original container available for app recovery.
if [[ -z "$actual_previous" && -n "$(state_get previous_container)" ]]; then
    docker stop --time 30 "$(state_get previous_container)" >/dev/null
fi
if compose_release "$RELEASE_DIR" up --detach --no-build --pull never --wait --wait-timeout "$WAIT_SECONDS" medsp; then
    atomic_link "$RELEASE_DIR" "$DEPLOY_ROOT/current"
    state_set deployment_status activated
    export_report
    say 'Application activated; comprehensive verification follows.'
else
    state_set status FAILURE
    state_set error_summary 'Docker Compose activation/health waiting failed; inspect the Jenkins job and application container logs.'
    rollback_application
    export_report
    exit 1
fi
