#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.bash"
load_config
install_traps
operation_lock
CURRENT_STEP=build-preflight
preflight
need git
[[ ! -f "$DEPLOY_ROOT/deployment-incomplete" ]] || die 'An earlier deployment needs review; see deployment-incomplete.'
[[ ! -e "$RELEASE_DIR" ]] || die 'Run ID already exists. Use a new build/run ID.'
git -C "$SOURCE_DIR" diff --quiet HEAD -- || die 'Commit all tracked changes before running the pipeline.'
COMMIT="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
[[ -z "${GIT_COMMIT:-}" || "$GIT_COMMIT" == "$COMMIT" ]] || die 'Checkout commit does not match Jenkins GIT_COMMIT.'
state_set branch "$TARGET_BRANCH"
state_set commit "$COMMIT"
state_set run_id "$INFRASH_RUN_ID"
state_set started_at "$(date -u +%FT%TZ)"
state_set status RUNNING
state_set error_summary ''

mkdir -p "$RELEASE_DIR/source"
git -C "$SOURCE_DIR" archive "$COMMIT" | tar -xf - -C "$RELEASE_DIR/source"
[[ -f "$RELEASE_DIR/source/infrash/compose.app.yml" && -f "$RELEASE_DIR/source/infrash/migrations.py" ]] || die 'Commit infrash and Jenkinsfile before starting.'
# Runtime configuration is deliberately outside the Docker build context.
install -m 600 "$APP_ENV_FILE" "$RELEASE_DIR/runtime.env"
python3 - "$RELEASE_DIR/source" "$RELEASE_DIR/runtime.env" <<'PY'
import base64, json, pathlib, sys, urllib.parse
root=pathlib.Path(sys.argv[1]); env={}
for p in root.rglob('.env*'):
    if p.name != '.env.example': raise SystemExit('A real .env file was committed; remove it from Git before building.')
for line in pathlib.Path(sys.argv[2]).read_text().splitlines():
    line=line.strip()
    if not line or line.startswith('#'): continue
    if '=' not in line: raise SystemExit('Use KEY=value lines in the runtime environment file.')
    k,v=line.split('=',1)
    if any(x in v for x in ('$', '\n')) or v.startswith(('"', "'")):
        raise SystemExit('Use unquoted literal values without Compose interpolation in the runtime .env.')
    env[k.strip()]=v.strip()
url=urllib.parse.urlsplit(env.get('SUPABASE_URL',''))
key=env.get('SUPABASE_KEY','')
if url.scheme not in ('http','https') or not url.hostname or not key: raise SystemExit('SUPABASE_URL and SUPABASE_KEY are required.')
if key.startswith('sb_secret_'): raise SystemExit('Use the public anon/publishable key, never a secret key.')
if key.count('.') == 2:
    try: role=json.loads(base64.urlsafe_b64decode(key.split('.')[1]+'==='))['role']
    except (ValueError, KeyError): raise SystemExit('Invalid public key payload.')
    if role != 'anon': raise SystemExit('The JWT supplied as SUPABASE_KEY must have the anon role.')
for k in ('MEDSP_DATA_DIR','MEDSP_DIST_DIR','MEDSP_ENV_FILE'):
    if env.get(k): raise SystemExit(f'{k} requires a reviewed Compose volume override; this bundle uses image data.')
PY
python3 "$INFRASH_DIR/migrations.py" validate --directory "$RELEASE_DIR/source/supabase/migrations"

CURRENT_STEP=docker-build
tag_suffix="$(printf '%s' "$INFRASH_RUN_ID" | sha256sum | cut -c1-12)"
image="medsp-local:${TARGET_BRANCH}-${COMMIT:0:12}-${tag_suffix}"
say "Building ${COMMIT} using the repository Dockerfile."
docker build --pull --label "org.opencontainers.image.revision=$COMMIT" \
    --label 'org.opencontainers.image.source=https://github.com/malikmehmetoglu-spec/MEDSP' \
    --tag "$image" --file "$RELEASE_DIR/source/Dockerfile" "$RELEASE_DIR/source"
image_id="$(docker image inspect --format '{{.Id}}' "$image")"
python3 - "$RELEASE_DIR/release.json" "$image" "$image_id" "$COMMIT" "$APP_PROJECT" "$APP_PORT" "$APP_BIND_IP" "$TARGET_BRANCH" <<'PY'
import json, sys
p,*v=sys.argv[1:]
with open(p,'w') as f: json.dump(dict(zip(('image','image_id','commit','project','port','bind','branch'),v)),f,indent=2)
PY
compose_release "$RELEASE_DIR" config --quiet
state_set image "$image"
state_set image_id "$image_id"
state_set release_dir "$RELEASE_DIR"
state_set build_status complete
export_report
say 'Image build completed; the running application has not been changed.'
