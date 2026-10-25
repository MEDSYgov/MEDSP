#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.bash"
load_config
install_traps
operation_lock
CURRENT_STEP=build-preflight
preflight
: "${PROXY_HOSTNAME:?Set PROXY_HOSTNAME in the environment-specific .conf}"
: "${PROXY_IP:?Set PROXY_IP in the environment-specific .conf}"

python3 - "$PROXY_HOSTNAME" "$PROXY_IP" "$APP_ENV_FILE" <<'PY'
import ipaddress
import pathlib
import re
import sys
import urllib.parse

host, address, env_path = sys.argv[1:]
label = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
if len(host) > 253 or not re.fullmatch(rf"{label}(?:\.{label})+", host):
    raise SystemExit("PROXY_HOSTNAME must be a DNS hostname, without a scheme or path.")
try:
    ipaddress.ip_address(host)
except ValueError:
    pass
else:
    raise SystemExit("PROXY_HOSTNAME must be a DNS hostname, not an IP address.")
try:
    ipaddress.ip_address(address)
except ValueError:
    raise SystemExit("PROXY_IP must be a confirmed IPv4 or IPv6 address.") from None

values = {}
for line in pathlib.Path(env_path).read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    if "=" not in line:
        raise SystemExit("Use KEY=value lines in the runtime environment file.")
    key, value = line.split("=", 1)
    values[key.strip()] = value.strip()
try:
    url = urllib.parse.urlsplit(values.get("SUPABASE_URL", ""))
    configured_host = url.hostname
except ValueError:
    raise SystemExit("SUPABASE_URL is invalid.") from None
if url.scheme not in ("http", "https") or not configured_host:
    raise SystemExit("SUPABASE_URL must be an absolute HTTP(S) URL.")
if configured_host.lower() != host.lower():
    raise SystemExit("PROXY_HOSTNAME must match the hostname in SUPABASE_URL.")
print("PASS: proxy configuration syntax and Supabase hostname match.")
PY

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
[[ -f "$RELEASE_DIR/source/docker-compose.yml.example" && -f "$RELEASE_DIR/source/infrash/migrations.py" ]] || die 'Commit the canonical Compose file and infrash before starting.'
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
    --label 'org.opencontainers.image.source=https://github.com/MEDSYgov/MEDSP' \
    --tag "$image" --file "$RELEASE_DIR/source/Dockerfile" "$RELEASE_DIR/source"
image_id="$(docker image inspect --format '{{.Id}}' "$image")"
python3 - "$RELEASE_DIR/release.json" "$image" "$image_id" "$COMMIT" \
    "$APP_PROJECT" "$APP_PORT" "$APP_BIND_IP" "$TARGET_BRANCH" \
    "$PROXY_HOSTNAME" "$PROXY_IP" <<'PY'
import json
import sys

filename, *values = sys.argv[1:]
keys = (
    "image", "image_id", "commit", "project", "port", "bind", "branch",
    "proxy_hostname", "proxy_ip",
)
if len(values) != len(keys):
    raise SystemExit("Unexpected release metadata arguments.")
document = dict(zip(keys, values))
document["compose_file"] = "docker-compose.yml.example"
with open(filename, "w", encoding="utf-8") as handle:
    json.dump(document, handle, indent=2)
    handle.write("\n")
PY
compose_release "$RELEASE_DIR" config --quiet
state_set image "$image"
state_set image_id "$image_id"
state_set release_dir "$RELEASE_DIR"
state_set build_status complete
export_report
say 'Image build completed; the running application has not been changed.'
