#!/usr/bin/env python3
"""Send an English, single-column Discord deployment report from Jenkins.

Usage: python3 notify.py [--state /path/to/state.json] [--dry-run]
Only --dry-run prints payload; normal delivery never prints secrets or response bodies.
"""
from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import json
import math
import os
from pathlib import Path
import re
import sys
import time
from typing import Any
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

REPOSITORY_URL = 'https://github.com/MEDSYgov/MEDSP'
MAX_STATE_BYTES = 256 * 1024
MAX_RESPONSE_BYTES = 64 * 1024
MAX_ATTEMPTS = 3
REQUEST_TIMEOUT = 10
MAX_RETRY_DELAY = 5

STATUSES = {
    'SUCCESS': ('✅', 'SUCCESS', 0x2ECC71, 'Deployment completed and all verification checks passed.'),
    'FAILURE': ('❌', 'FAILED', 0xE74C3C, 'Deployment failed. Review the stage and error details below.'),
    'ABORTED': ('⏹️', 'ABORTED', 0x95A5A6, 'Deployment was cancelled or timed out.'),
    'UNSTABLE': ('⚠️', 'UNSTABLE', 0xF39C12, 'Deployment completed with warnings or incomplete checks.'),
    'NOT_BUILT': ('⏸️', 'NOT BUILT', 0x95A5A6, 'Deployment stages were not executed.'),
    'UNKNOWN': ('❔', 'UNKNOWN', 0x95A5A6, 'The deployment result is unavailable.'),
}
PHASES = {
    'Initialization': 'Initialization', 'Branch gate': 'Branch validation',
    'Checkout': 'Checkout', 'Build': 'Docker build', 'Backup': 'Backup',
    'Deploy and migrate': 'Deployment & database migrations',
    'Verification': 'Verification', 'Completed': 'Completed',
}
STATE_WORDS = {
    'pending': 'Pending', 'not_started': 'Not started', 'skipped': 'Skipped',
    'running': 'Running', 'success': 'Successful', 'successful': 'Successful',
    'complete': 'Completed', 'completed': 'Completed', 'passed': 'Passed',
    'verified': 'Verified', 'failed': 'Failed', 'failure': 'Failed',
    'not_needed': 'Not required', 'not_attempted': 'Not attempted',
    'restored': 'Previous version restored', 'unavailable': 'Unavailable',
    'none': 'None',
}


def plain(value: Any, limit: int = 300) -> str:
    if not isinstance(value, (str, int, float, bool)):
        return ''
    result = str(value).replace('\r', ' ').replace('\n', ' ')
    result = re.sub(r'[\x00-\x1f\x7f]', '', result)
    for name in ('DISCORD_WEBHOOK_URL', 'PGPASSWORD', 'DATABASE_URL',
                 'DATABASE_PASSWORD', 'SUPABASE_DB_PASSWORD',
                 'SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY', 'JWT_SECRET'):
        secret = os.environ.get(name, '')
        if len(secret) >= 4:
            result = result.replace(secret, '[REDACTED]')
    result = re.sub(r'https://(?:canary\.|ptb\.)?discord(?:app)?\.com/api/[^\s<>]+',
                    '[REDACTED WEBHOOK]', result, flags=re.I)
    result = re.sub(r'postgres(?:ql)?://[^\s<>]+', '[REDACTED DATABASE URL]', result, flags=re.I)
    result = re.sub(r'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b',
                    '[REDACTED TOKEN]', result)
    result = re.sub(
        r'(?i)\b(password|passwd|secret|token|api[_-]?key|service[_-]?role[_-]?key)'
        r'(\s*[=:]\s*)(?:"[^"]*"|\'[^\']*\'|[^\s,;]+)',
        r'\1\2[REDACTED]', result)
    result = result.strip()
    return result[:limit - 1] + '…' if len(result) > limit else result


def units(value: str) -> int:
    return len(value.encode('utf-16-le')) // 2


def truncate(value: str, max_units: int) -> str:
    if units(value) <= max_units:
        return value
    return value.encode('utf-16-le')[:(max_units - 1) * 2].decode('utf-16-le', 'ignore') + '…'


def md(value: Any, limit: int = 180, default: str = 'N/A') -> str:
    value = plain(value, limit)
    if not value:
        return default
    return re.sub(r'([\\`*_~|>\[\]()#])', r'\\\1', value)


def read_state(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    try:
        with Path(path).open('rb') as handle:
            data = handle.read(MAX_STATE_BYTES + 1)
        if len(data) > MAX_STATE_BYTES:
            return {}
        obj = json.loads(data)
        return obj if isinstance(obj, dict) else {}
    except (OSError, UnicodeError, ValueError):
        return {}


def state_word(value: Any, default: str = 'N/A') -> str:
    key = str(value).strip().lower() if value is not None else ''
    return STATE_WORDS.get(key, md(value, 90, default))


def public_link(raw: str) -> str:
    if not raw or re.search(r'[\x00-\x20\x7f]', raw):
        return ''
    try:
        parsed = urllib.parse.urlsplit(raw)
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname
                or parsed.username is not None or parsed.password is not None):
            return ''
        _ = parsed.port
        path = urllib.parse.quote(parsed.path, safe='/:%@+._~-')
        result = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, '', ''))
        return result if len(result) <= 380 else ''
    except ValueError:
        return ''


def duration_label(raw: Any) -> str:
    try:
        seconds = float(raw)
        if not math.isfinite(seconds) or seconds < 0:
            return 'N/A'
        hours, remaining = divmod(int(seconds), 3600)
        minutes, seconds = divmod(remaining, 60)
        return f'{hours:02d}:{minutes:02d}:{seconds:02d}'
    except (ValueError, TypeError, OverflowError):
        return 'N/A'


def make_payload(state: dict[str, Any]) -> dict[str, Any]:
    env = os.environ
    status = str(env.get('DEPLOY_RESULT') or state.get('status') or 'UNKNOWN').upper()
    symbol, label, color, description = STATUSES.get(status, STATUSES['UNKNOWN'])
    now = dt.datetime.now(dt.timezone.utc)
    try:
        local = now.astimezone(ZoneInfo('Asia/Damascus'))
        timezone = 'Damascus'
    except ZoneInfoNotFoundError:
        local, timezone = now, 'UTC'

    branch = env.get('BRANCH_NAME', '')
    environment = env.get('DEPLOY_ENV') or {'main': 'production', 'staging': 'staging'}.get(branch, '')
    phase = PHASES.get(env.get('LAST_PHASE', ''), env.get('LAST_PHASE', ''))
    commit = env.get('GIT_COMMIT', '')
    commit = commit if re.fullmatch(r'[0-9a-fA-F]{40,64}', commit) else ''
    build_url = public_link(env.get('BUILD_URL', ''))

    def line(emoji: str, name: str, value: Any, limit: int = 170) -> str:
        return f'{emoji} **{name}:** {md(value, limit)}'

    backup = state_word(state.get('backup_status'))
    migration = state_word(state.get('migration_status'))
    count = state.get('migration_count')
    if isinstance(count, str) and re.fullmatch(r'[0-9]{1,10}', count.strip()):
        count = int(count.strip())
    if isinstance(count, int) and not isinstance(count, bool) and count >= 0:
        migration += f' ({count} changes)'

    lines = [
        f'{symbol} {description}',
        '', '**📋 BUILD INFORMATION**',
        line('🌿', 'Branch', branch),
        line('🏷️', 'Environment', environment),
        line('🔢', 'Build', f"#{env.get('BUILD_NUMBER', '?')}"),
        line('👤', 'Triggered by', env.get('TRIGGER_ACTOR')),
        line('🧑‍💻', 'Commit author', env.get('COMMIT_AUTHOR')),
        line('📧', 'Author email', env.get('COMMIT_AUTHOR_EMAIL')),
        line('📝', 'Commit message', env.get('COMMIT_SUBJECT'), 220),
        '', '**⚙️ DEPLOYMENT STATUS**',
        line('📍', 'Last stage', phase),
        line('💾', 'Backup', backup),
        line('🗃️', 'DB migrations', migration),
        line('🩺', 'Verification', state_word(state.get('verification_status'))),
        line('↩️', 'Rollback', state_word(state.get('rollback_status'), 'Not required')),
        '', '**⏱️ EXECUTION DETAILS**',
        line('⏳', 'Duration', duration_label(env.get('BUILD_DURATION_SECONDS'))),
        line('🕒', f'Local time ({timezone})', local.strftime('%Y-%m-%d %H:%M:%S')),
        line('📊', 'Result', f'{symbol} {label}'),
    ]
    if state.get('backup_path'):
        lines.append(line('📦', 'Backup directory', state['backup_path'], 250))
    if state.get('release_dir'):
        lines.append(line('📁', 'Release directory', state['release_dir'], 250))
    if state.get('image') or state.get('image_tag'):
        lines.append(line('🐳', 'Docker image', state.get('image') or state.get('image_tag'), 180))

    if state.get('error_summary'):
        lines.extend(['', '**⚠️ ERROR SUMMARY**',
                      line('🔎', 'Details', state['error_summary'], 260)])
    elif status != 'SUCCESS':
        lines.extend(['', '**⚠️ ERROR SUMMARY**',
                      '🔎 See the Jenkins console log for the underlying failure.'])

    links = []
    if build_url:
        links.extend([f'[🔗 Open build]({build_url})',
                      f'[📜 Console log]({build_url.rstrip("/")}/console)'])
    if commit:
        links.append(f'[🧾 Commit {commit[:12]}]({REPOSITORY_URL}/commit/{commit})')
    if links:
        lines.extend(['', '**🔗 QUICK LINKS**', '  |  '.join(links)])

    # Discord allows 4096 UTF-16 units for description and 6000 per embed.
    # Reserve space for title and footer; drop optional long lines before clipping.
    title = f'{symbol} MEDSP Deployment | {label}'
    footer = f'Jenkins #{plain(env.get("BUILD_NUMBER"), 20) or "?"} | {plain(env.get("JOB_NAME"), 100) or "MEDSP"}'
    limit = min(3900, 5700 - units(title) - units(footer))
    description_text = '\n'.join(lines)
    if units(description_text) > limit:
        description_text = truncate(description_text, limit)

    embed = {
        'title': title,
        'description': description_text,
        'color': color,
        'timestamp': now.isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'footer': {'text': footer},
    }
    if build_url:
        embed['url'] = build_url
    return {
        'username': 'MEDSP Jenkins',
        'allowed_mentions': {'parse': []},
        'embeds': [embed],
    }


def webhook_url(raw: str) -> str:
    """Restrict destinations to the Discord webhook API and force delivery confirmation."""
    try:
        parsed = urllib.parse.urlsplit(raw)
        if (parsed.scheme != 'https' or parsed.hostname != 'discord.com'
                or parsed.username is not None or parsed.password is not None
                or parsed.port not in (None, 443) or parsed.fragment
                or re.search(r'[\x00-\x20\x7f]', raw)
                or not re.fullmatch(r'/api(?:/v[0-9]+)?/webhooks/[0-9]+/[A-Za-z0-9._-]+/?', parsed.path)):
            raise ValueError('Invalid Discord webhook configuration')
        query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
        if set(query) - {'wait', 'thread_id'}:
            raise ValueError('Invalid Discord webhook configuration')
        if 'thread_id' in query and not query['thread_id'].isdigit():
            raise ValueError('Invalid Discord thread configuration')
        query['wait'] = 'true'
        return urllib.parse.urlunsplit(('https', 'discord.com', parsed.path,
                                       urllib.parse.urlencode(query), ''))
    except (TypeError, ValueError) as error:
        raise ValueError('Invalid Discord webhook configuration') from error


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str,
                         headers: Any, newurl: str) -> None:
        return None


def retry_delay(error: urllib.error.HTTPError, attempt: int) -> float | None:
    delay: float | None = None
    retry_after = error.headers.get('Retry-After') if error.headers else None
    if retry_after:
        try:
            delay = float(retry_after)
        except ValueError:
            try:
                until = email.utils.parsedate_to_datetime(retry_after)
                if until.tzinfo is None:
                    until = until.replace(tzinfo=dt.timezone.utc)
                delay = (until - dt.datetime.now(dt.timezone.utc)).total_seconds()
            except (TypeError, ValueError, OverflowError):
                pass
    if delay is None and error.code == 429:
        try:
            delay = float(json.loads(error.read(4096))['retry_after'])
        except (OSError, ValueError, KeyError, TypeError):
            pass
    delay = (2 ** attempt) if delay is None else delay
    if not math.isfinite(delay) or delay > MAX_RETRY_DELAY:
        return None
    return max(0.0, delay)


def send(payload: dict[str, Any], url: str) -> int:
    encoded = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    opener = urllib.request.build_opener(NoRedirect())
    for attempt in range(MAX_ATTEMPTS):
        request = urllib.request.Request(url, data=encoded, method='POST', headers={
            'Content-Type': 'application/json; charset=utf-8',
            'User-Agent': 'MEDSP-Jenkins-Notifier/2.0',
        })
        try:
            with opener.open(request, timeout=REQUEST_TIMEOUT) as response:
                data = response.read(MAX_RESPONSE_BYTES + 1)
                if response.status != 200 or len(data) > MAX_RESPONSE_BYTES:
                    print('Discord did not confirm delivery.', file=sys.stderr)
                    return 1
                try:
                    result = json.loads(data)
                except (ValueError, UnicodeError):
                    result = None
                if not isinstance(result, dict) or not result.get('id'):
                    print('Discord did not confirm delivery.', file=sys.stderr)
                    return 1
                print('Discord notification delivered.')
                return 0
        except urllib.error.HTTPError as error:
            transient = error.code in {408, 429, 500, 502, 503, 504}
            delay = retry_delay(error, attempt) if transient else None
            error.close()
            if not transient or delay is None or attempt + 1 >= MAX_ATTEMPTS:
                print(f'Discord notification failed (HTTP {error.code}).', file=sys.stderr)
                return 1
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt + 1 >= MAX_ATTEMPTS:
                print('Discord notification failed (network or TLS error).', file=sys.stderr)
                return 1
            time.sleep(min(2 ** attempt, MAX_RETRY_DELAY))
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', help='Optional deployment state.json path')
    parser.add_argument('--dry-run', action='store_true',
                        help='Print JSON without sending any HTTP request')
    args = parser.parse_args()
    payload = make_payload(read_state(args.state))
    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    try:
        url = webhook_url(os.environ.get('DISCORD_WEBHOOK_URL', ''))
    except ValueError:
        print('Discord webhook is missing or invalid.', file=sys.stderr)
        return 1
    try:
        return send(payload, url)
    except Exception:
        print('Discord notification failed (unexpected delivery error).', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
