#!/usr/bin/env python3
"""Send a bounded, secret-redacted Discord deployment notification.

Only --dry-run prints the generated payload. Normal operation prints a generic
delivery result and never a webhook URL, response body or raw deployment log.
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


MAX_STATE_BYTES = 256 * 1024
MAX_RESPONSE_BYTES = 64 * 1024
REQUEST_TIMEOUT = 10
MAX_ATTEMPTS = 3
MAX_RETRY_DELAY = 5
REPOSITORY_URL = 'https://github.com/MEDSYgov/MEDSP'

STATUSES = {
    'SUCCESS': ('✅', 'ناجح', 0x2ECC71, 'اكتمل النشر واجتازت الخدمة فحوصات التحقق.'),
    'FAILURE': ('❌', 'فشل', 0xE74C3C, 'توقف مسار النشر بسبب خطأ. راجع المرحلة والملخص أدناه.'),
    'ABORTED': ('⏹️', 'متوقف', 0x95A5A6, 'أُلغي التشغيل أو انتهت المهلة. يلزم مراجعة الحالة الحالية قبل إعادة النشر.'),
    'UNSTABLE': ('⚠️', 'غير مستقر', 0xF39C12, 'انتهى التشغيل مع تحذير أو تحقق غير مكتمل.'),
    'NOT_BUILT': ('⏸️', 'لم يُنفّذ', 0x95A5A6, 'لم تكتمل مراحل النشر في هذا التشغيل.'),
    'UNKNOWN': ('❔', 'غير معروف', 0x95A5A6, 'لم تتوفر نتيجة مؤكدة للتشغيل.'),
}

PHASES = {
    'Initialization': 'التهيئة',
    'Branch gate': 'التحقق من الفرع',
    'Checkout': 'سحب المصدر',
    'Build': 'بناء صورة Docker',
    'Backup': 'النسخ الاحتياطي',
    'Deploy and migrate': 'النشر وترحيلات قاعدة البيانات',
    'Verification': 'التحقق من الخدمة',
    'Completed': 'مكتمل',
}

STATE_WORDS = {
    'pending': 'بانتظار التنفيذ',
    'not_started': 'لم يبدأ',
    'skipped': 'تم التجاوز',
    'running': 'قيد التنفيذ',
    'success': 'ناجح',
    'successful': 'ناجح',
    'complete': 'مكتمل',
    'completed': 'مكتمل',
    'passed': 'اجتاز الفحص',
    'verified': 'تم التحقق',
    'failed': 'فشل',
    'failure': 'فشل',
    'not_needed': 'غير مطلوب',
    'not_attempted': 'لم يُنفّذ',
    'restored': 'أُعيدت النسخة السابقة',
    'unavailable': 'غير متاح',
    'none': 'لا يوجد',
}


def plain(value: Any, limit: int = 300) -> str:
    """Bound and redact untrusted metadata before putting it in a message."""
    if value is None:
        return ''
    if not isinstance(value, (str, int, float, bool)):
        return ''
    result = str(value).encode('utf-8', errors='replace').decode('utf-8')
    result = result.replace('\r\n', '\n').replace('\r', '\n')
    result = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', result)
    for key in (
        'DISCORD_WEBHOOK_URL', 'PGPASSWORD', 'DATABASE_URL',
        'DATABASE_PASSWORD', 'SUPABASE_DB_PASSWORD', 'SUPABASE_SERVICE_ROLE_KEY',
        'SERVICE_ROLE_KEY', 'JWT_SECRET',
    ):
        secret = os.environ.get(key, '')
        if len(secret) >= 4:
            result = result.replace(secret, '[محجوب]')
    result = re.sub(r'https://(?:canary\.|ptb\.)?discord(?:app)?\.com/api/[^\s<>]+',
                    '[رابط سري محجوب]', result, flags=re.IGNORECASE)
    result = re.sub(r'postgres(?:ql)?://[^\s<>]+', '[اتصال قاعدة البيانات محجوب]',
                    result, flags=re.IGNORECASE)
    result = re.sub(r'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b',
                    '[رمز محجوب]', result)
    result = re.sub(
        r'(?i)\b(password|passwd|secret|token|api[_-]?key|service[_-]?role[_-]?key)'
        r'(\s*[=:]\s*)(?:"[^"]*"|\'[^\']*\'|[^\s,;]+)',
        r'\1\2[محجوب]', result,
    )
    result = result.strip()
    return result if len(result) <= limit else result[:limit - 1] + '…'


def discord_units(value: str) -> int:
    """Count UTF-16 units conservatively, including supplementary emoji."""
    return len(value.encode('utf-16-le')) // 2


def truncate(value: str, limit: int) -> str:
    if discord_units(value) <= limit:
        return value
    return value.encode('utf-16-le')[:max(0, limit - 1) * 2].decode(
        'utf-16-le', errors='ignore') + '…'


def markdown(value: Any, limit: int = 300, default: str = 'غير متاح') -> str:
    result = plain(value, limit)
    if not result:
        return default
    # Metadata can otherwise break link formatting or impersonate a status line.
    result = re.sub(r'([\\`*_~|>\[\]()#])', r'\\\1', result)
    return truncate(result, min(1024, limit * 2))


def read_state(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    try:
        with Path(path).open('rb') as handle:
            data = handle.read(MAX_STATE_BYTES + 1)
        if len(data) > MAX_STATE_BYTES:
            return {}
        value = json.loads(data)
        return value if isinstance(value, dict) else {}
    except (OSError, UnicodeError, ValueError):
        return {}


def state_word(value: Any, default: str = 'غير متاح') -> str:
    key = str(value).strip().lower() if value is not None else ''
    return STATE_WORDS.get(key, markdown(value, 120, default))


def public_link(raw: str) -> str:
    """Exclude credentials, queries and control characters from displayed links."""
    if not raw or re.search(r'[\x00-\x20\x7f]', raw):
        return ''
    try:
        parsed = urllib.parse.urlsplit(raw)
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname
                or parsed.username is not None or parsed.password is not None):
            return ''
        # Ensure a malformed port cannot make it into the message.
        _ = parsed.port
        path = urllib.parse.quote(parsed.path, safe='/:%@+._~-')
        result = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, '', ''))
        return result if len(result) <= 380 else ''
    except ValueError:
        return ''


def duration_label(raw: str) -> str:
    try:
        seconds = float(raw)
        if not math.isfinite(seconds) or seconds < 0:
            return 'غير متاح'
        seconds = int(seconds)
    except (TypeError, ValueError, OverflowError):
        return 'غير متاح'
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f'{hours:02d}:{minutes:02d}:{seconds:02d}'


def make_payload(state: dict[str, Any]) -> dict[str, Any]:
    env = os.environ
    status = str(env.get('DEPLOY_RESULT') or state.get('status') or 'UNKNOWN').upper()
    symbol, label, color, description = STATUSES.get(status, STATUSES['UNKNOWN'])
    now = dt.datetime.now(dt.timezone.utc)
    try:
        local = now.astimezone(ZoneInfo('Asia/Damascus'))
    except ZoneInfoNotFoundError:
        local = now  # Label retains the real zone; never pretend UTC is Damascus.
    local_label = 'دمشق' if getattr(local.tzinfo, 'key', '') == 'Asia/Damascus' else 'UTC'
    branch = env.get('BRANCH_NAME', '')
    environment = env.get('DEPLOY_ENV') or {'main': 'production', 'staging': 'staging'}.get(branch, '')
    phase = env.get('LAST_PHASE', '')
    phase = PHASES.get(phase, phase)
    commit = env.get('GIT_COMMIT', '')
    commit = commit if re.fullmatch(r'[0-9a-fA-F]{40,64}', commit) else ''
    job_url = public_link(env.get('BUILD_URL', ''))
    links = []
    if job_url:
        links.extend([
            f'[فتح عملية Jenkins]({job_url})',
            f'[سجل العملية والخطأ]({job_url.rstrip("/")}/console)',
        ])
    if commit:
        links.append(f'[التعديل {commit[:12]}]({REPOSITORY_URL}/commit/{commit})')

        def ltr(value: str) -> str:
            """Keep Latin text, URLs and numbers together in Arabic Discord messages."""
            return '\u2066' + value + '\u2069'

        def line(icon: str, title: str, value: str) -> str:
            return f'{icon} **{title}:** {ltr(value)}'

        branch_text = markdown(branch, 60)
        environment_text = markdown(environment, 60)
        phase_text = markdown(phase, 100)

        backup = state_word(state.get('backup_status'))
        migrations = state_word(state.get('migration_status'))
        verification = state_word(state.get('verification_status'))
        rollback = state_word(state.get('rollback_status'), 'لم تُطلب')

        count = state.get('migration_count')
        if isinstance(count, str) and re.fullmatch(r'[0-9]{1,100}', count.strip()):
            count = int(count.strip())

        if isinstance(count, int) and not isinstance(count, bool) and count >= 0:
            migrations += f' ({count})'

        lines = [
            f'{symbol} **{description}**',
            '',
            '**📋 معلومات التشغيل**',
            line('🌿', 'الفرع', branch_text),
            line('🏷️', 'البيئة', environment_text),
            line('🔢', 'رقم البناء', markdown(env.get('BUILD_NUMBER'), 30)),
            line('👤', 'منفّذ التشغيل', markdown(env.get('TRIGGER_ACTOR'), 100)),
            line('🧑‍💻', 'صاحب التعديل', markdown(env.get('COMMIT_AUTHOR'), 100)),
            line('📧', 'البريد الإلكتروني', markdown(env.get('COMMIT_AUTHOR_EMAIL'), 140)),
            line('📝', 'رسالة التعديل', markdown(env.get('COMMIT_SUBJECT'), 180)),
            '',
            '**⚙️ حالة النشر**',
            line('📍', 'المرحلة الأخيرة', phase_text),
            line('💾', 'النسخ الاحتياطي', backup),
            line('🗄️', 'ترحيلات قاعدة البيانات', migrations),
            line('🩺', 'التحقق من الخدمة', verification),
            line('↩️', 'التراجع', rollback),
            '',
            '**⏱️ الوقت والنتيجة**',
            line('⏳', 'مدة التنفيذ', duration_label(env.get('BUILD_DURATION_SECONDS', ''))),
            line('📅', f'وقت التقرير ({local_label})', local.strftime('%Y-%m-%d %H:%M:%S')),
            line('📊', 'النتيجة النهائية', f'{symbol} {label}'),
        ]

        if state.get('backup_path'):
            lines.append(
                line('📦', 'مسار النسخة الاحتياطية',
                     markdown(state.get('backup_path'), 180))
            )

        if state.get('error_summary'):
            error_text = plain(state.get('error_summary'), 300).replace('`', "'")
            lines.extend([
                '',
                '**⚠️ تفاصيل الخطأ**',
                f'```text\n{error_text}\n```'
            ])
        elif status != 'SUCCESS':
            lines.extend([
                '',
                '**⚠️ تفاصيل الخطأ**',
                'راجع سجل Jenkins لتحديد السبب والمرحلة التي توقفت.'
            ])

        if links:
            lines.extend([
                '',
                '**🔗 روابط المتابعة**',
                *[f'• {link}' for link in links]
            ])

        embed = {
            'title': f'{symbol} MEDSP | {label}',
            'description': truncate('\n'.join(lines), 4000),
            'color': color,
            'timestamp': now.isoformat(timespec='seconds').replace('+00:00', 'Z'),
            'footer': {
                'text': (
                    f'Jenkins #{plain(env.get("BUILD_NUMBER"), 30) or "?"}'
                    f' | {plain(env.get("JOB_NAME"), 100) or "MEDSP"}'
                )
            }
        }

        if job_url:
            embed['url'] = job_url

        return {
            'username': 'MEDSP · Jenkins',
            'allowed_mentions': {'parse': []},
            'embeds': [embed],
        }
    # Enforce Discord's combined embed budget even for hostile long metadata.
    # Keep links intact and shorten the longest text fields first.
    def embed_units() -> int:
        return (discord_units(embed['title']) + discord_units(embed['description'])
                + discord_units(embed['footer']['text'])
                + sum(discord_units(item['name']) + discord_units(item['value'])
                      for item in fields))

    while embed_units() > 5800:
        candidates = [item for item in fields if item['name'] != 'روابط المتابعة'
                      and discord_units(item['value']) > 80]
        if not candidates:
            break
        longest = max(candidates, key=lambda item: discord_units(item['value']))
        excess = embed_units() - 5800
        longest['value'] = truncate(longest['value'],
                                    max(80, discord_units(longest['value']) - excess))
    return {
        'username': 'MEDSP · Jenkins',
        'content': f'### {symbol} نشر MEDSP — {label}',
        'allowed_mentions': {'parse': []},
        'embeds': [embed],
    }


def webhook_url(raw: str) -> str:
    """Accept only the Discord HTTPS incoming-webhook endpoint."""
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
            body = json.loads(error.read(4096))
            delay = float(body['retry_after'])
        except (OSError, ValueError, KeyError, TypeError):
            pass
    delay = (2 ** attempt) if delay is None else delay
    # Do not hammer Discord before a longer requested rate-limit delay expires.
    if not math.isfinite(delay) or delay > MAX_RETRY_DELAY:
        return None
    return max(0.0, delay)


def send(payload: dict[str, Any], url: str) -> int:
    encoded = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    opener = urllib.request.build_opener(NoRedirect())
    for attempt in range(MAX_ATTEMPTS):
        request = urllib.request.Request(url, data=encoded, method='POST', headers={
            'Content-Type': 'application/json; charset=utf-8',
            'User-Agent': 'MEDSP-Jenkins-Notifier/1.0',
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
    parser.add_argument('--dry-run', action='store_true', help='Print JSON without sending any request')
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
        # Unexpected HTTP/proxy/parser errors must not expose a webhook through
        # a traceback, and must not replace the deployment's original outcome.
        print('Discord notification failed (unexpected delivery error).', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
