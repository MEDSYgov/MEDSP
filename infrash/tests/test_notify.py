"""Offline behavioral checks for MEDSP Discord notifications.

Run: PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s infrash/tests -p test_notify.py -v
No test sends a network request or uses a real Discord credential.
"""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import urllib.error
import urllib.parse


SOURCE = Path(__file__).resolve().parents[1] / 'notify.py'
SPEC = importlib.util.spec_from_file_location('medsp_notify', SOURCE)
notify = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(notify)

FAKE_WEBHOOK = 'https://discord.com/api/webhooks/1234567890/FAKE_ONLY_TEST_TOKEN'
BASE_ENV = {
    'DEPLOY_RESULT': 'SUCCESS',
    'BRANCH_NAME': 'staging',
    'DEPLOY_ENV': 'staging',
    'GIT_COMMIT': 'a' * 40,
    'COMMIT_AUTHOR': 'Commit Author',
    'COMMIT_AUTHOR_EMAIL': 'author@example.org',
    'COMMIT_SUBJECT': 'Update project',
    'TRIGGER_ACTOR': 'Jenkins user: Release Operator',
    'BUILD_URL': 'https://pipeline.med.gov.sy/job/MEDSP/job/staging/13/',
    'BUILD_NUMBER': '13',
    'JOB_NAME': 'MEDSP/staging',
    'LAST_PHASE': 'Verification',
    'BUILD_DURATION_SECONDS': '92',
}


def field_values(payload):
    return {field['name']: field['value'] for field in payload['embeds'][0]['fields']}


def units(value):
    return len(value.encode('utf-16-le')) // 2


class NotifyTests(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, BASE_ENV, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_all_pipeline_statuses_have_distinct_result_labels(self):
        cases = {
            'SUCCESS': ('ناجح', 0x2ECC71),
            'FAILURE': ('فشل', 0xE74C3C),
            'ABORTED': ('متوقف', 0x95A5A6),
            'UNSTABLE': ('غير مستقر', 0xF39C12),
            'NOT_BUILT': ('لم يُنفّذ', 0x95A5A6),
            'unexpected': ('غير معروف', 0x95A5A6),
        }
        for result, (label, color) in cases.items():
            with self.subTest(result=result), mock.patch.dict(os.environ, {'DEPLOY_RESULT': result}):
                payload = notify.make_payload({'status': 'success'})
                self.assertEqual(payload['embeds'][0]['title'], 'MEDSP — ' + label)
                self.assertEqual(payload['embeds'][0]['color'], color)

    def test_pipeline_abort_overrides_prior_successful_state(self):
        os.environ['DEPLOY_RESULT'] = 'ABORTED'
        payload = notify.make_payload({'status': 'success', 'verification_status': 'passed'})
        self.assertIn('متوقف', payload['content'])
        self.assertIn('ملخص الخطأ', field_values(payload))

    def test_json_encoding_preserves_quotes_arabic_and_newlines(self):
        subject = 'Fix "reported value"\nإصلاح واجهة العرض'
        os.environ['COMMIT_SUBJECT'] = subject
        payload = notify.make_payload({})
        restored = json.loads(json.dumps(payload, ensure_ascii=False))
        self.assertEqual(field_values(restored)['رسالة التعديل'], subject)
        self.assertEqual(restored['allowed_mentions'], {'parse': []})

    def test_hostile_long_metadata_respects_discord_limits(self):
        text = '@everyone "' + '*`😀' * 5000
        for key in ('COMMIT_AUTHOR', 'COMMIT_AUTHOR_EMAIL', 'COMMIT_SUBJECT',
                    'TRIGGER_ACTOR', 'JOB_NAME', 'LAST_PHASE'):
            os.environ[key] = text
        state = {key: text for key in (
            'error_summary', 'backup_status', 'backup_path', 'migration_status',
            'verification_status', 'rollback_status', 'image', 'release_dir')}
        payload = notify.make_payload(state)
        self.assertLessEqual(units(payload['content']), 2000)
        self.assertEqual(payload['allowed_mentions']['parse'], [])
        embed = payload['embeds'][0]
        total = units(embed['title'] + embed['description'] + embed['footer']['text'])
        self.assertLessEqual(len(embed['fields']), 25)
        for field in embed['fields']:
            self.assertLessEqual(units(field['name']), 256)
            self.assertLessEqual(units(field['value']), 1024)
            total += units(field['name'] + field['value'])
        self.assertLessEqual(total, 6000)

    def test_secrets_and_sensitive_urls_are_redacted(self):
        os.environ['DISCORD_WEBHOOK_URL'] = FAKE_WEBHOOK
        os.environ['PGPASSWORD'] = 'FAKE_DB_PASSWORD'
        secret_url = 'postgresql://admin:another_secret@database.internal/postgres'
        state = {'error_summary': f'{FAKE_WEBHOOK} {secret_url} '
                 'password=FAKE_DB_PASSWORD token=ANOTHER_PRIVATE_VALUE'}
        encoded = json.dumps(notify.make_payload(state), ensure_ascii=False)
        for secret in (FAKE_WEBHOOK, secret_url, 'FAKE_DB_PASSWORD',
                       'ANOTHER_PRIVATE_VALUE', 'another_secret'):
            self.assertNotIn(secret, encoded)
        self.assertIn('محجوب', encoded)

    def test_displayed_job_links_exclude_credentials_and_query_tokens(self):
        os.environ['BUILD_URL'] = BASE_ENV['BUILD_URL'] + '?token=PRIVATE_QUERY#private'
        serialized = json.dumps(notify.make_payload({}), ensure_ascii=False)
        self.assertNotIn('PRIVATE_QUERY', serialized)
        self.assertIn('/console', serialized)
        self.assertEqual(notify.public_link('https://user:secret@jenkins.example/job/1/'), '')

    def test_webhook_url_is_restricted_and_requires_confirmation(self):
        url = notify.webhook_url(FAKE_WEBHOOK + '?wait=false&thread_id=1234')
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        self.assertEqual(query, {'wait': ['true'], 'thread_id': ['1234']})
        invalid = [
            'http://discord.com/api/webhooks/1/TOKEN',
            'https://discord.com.evil.example/api/webhooks/1/TOKEN',
            'https://discord.com@evil.example/api/webhooks/1/TOKEN',
            'https://evil.example/api/webhooks/1/TOKEN',
            'https://discord.com:444/api/webhooks/1/TOKEN',
            'https://discord.com/api/users/1',
            FAKE_WEBHOOK + '?unexpected=true',
            FAKE_WEBHOOK + '?thread_id=invalid',
            FAKE_WEBHOOK + '#fragment',
            FAKE_WEBHOOK + '\n',
            '',
        ]
        for value in invalid:
            with self.subTest(url=value), self.assertRaises(ValueError):
                notify.webhook_url(value)

    def test_redirect_handler_does_not_follow_to_another_host(self):
        self.assertIsNone(notify.NoRedirect().redirect_request(
            None, None, 302, 'Redirect', {}, 'https://evil.example/'))

    def test_commit_author_and_operator_remain_separate(self):
        values = field_values(notify.make_payload({}))
        self.assertEqual(values['صاحب التعديل'], 'Commit Author')
        self.assertEqual(values['بريده المسجل في Git'], 'author@example.org')
        self.assertEqual(values['مشغّل النشر / مصدر التشغيل'], 'Jenkins user: Release Operator')
        os.environ['TRIGGER_ACTOR'] = 'GitHub / SCM / branch indexing'
        values = field_values(notify.make_payload({}))
        self.assertEqual(values['مشغّل النشر / مصدر التشغيل'], 'GitHub / SCM / branch indexing')
        self.assertNotIn('pusher', json.dumps(values, ensure_ascii=False).lower())

    def test_migration_count_supports_shell_string_state(self):
        for value, expected in [(0, 0), (3, 3), ('0', 0), ('12', 12), ('0002', 2), (' 7 ', 7)]:
            with self.subTest(value=value):
                values = field_values(notify.make_payload({
                    'migration_status': 'completed', 'migration_count': value}))
                self.assertIn(f'عدد الترحيلات: {expected}', values['ترحيلات قاعدة البيانات'])
        for value in (True, False, -1, 1.5, '-1', '1.5', 'not a count', '', None):
            with self.subTest(invalid=value):
                values = field_values(notify.make_payload({'migration_count': value}))
                self.assertNotIn('عدد الترحيلات:', values['ترحيلات قاعدة البيانات'])

    def test_missing_invalid_and_oversized_state_fall_back(self):
        self.assertEqual(notify.read_state(None), {})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            self.assertEqual(notify.read_state(str(path)), {})
            path.write_text('{broken', encoding='utf-8')
            self.assertEqual(notify.read_state(str(path)), {})
            path.write_text('[]', encoding='utf-8')
            self.assertEqual(notify.read_state(str(path)), {})
            path.write_text(' ' * (notify.MAX_STATE_BYTES + 1), encoding='utf-8')
            self.assertEqual(notify.read_state(str(path)), {})
            path.write_text('{"migration_count":"2"}', encoding='utf-8')
            self.assertEqual(notify.read_state(str(path)), {'migration_count': '2'})

    def test_checkout_failure_notification_works_without_metadata(self):
        with mock.patch.dict(os.environ, {'DEPLOY_RESULT': 'FAILURE', 'LAST_PHASE': 'Checkout'}, clear=True):
            payload = notify.make_payload({})
        values = field_values(payload)
        self.assertIn('فشل', payload['content'])
        self.assertEqual(values['المرحلة الأخيرة'], 'سحب المصدر')
        self.assertEqual(values['صاحب التعديل'], 'غير متاح')
        self.assertIn('ملخص الخطأ', values)
        self.assertNotIn('روابط المتابعة', values)

    def test_state_status_fallback_and_unavailable_duration(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            payload = notify.make_payload({'status': 'failure'})
        self.assertIn('فشل', payload['content'])
        for raw in ('nan', 'inf', '-1', 'bad', ''):
            self.assertEqual(notify.duration_label(raw), 'غير متاح')
        self.assertEqual(notify.duration_label('92'), '00:01:32')

    def test_dry_run_never_attempts_network(self):
        output = io.StringIO()
        with mock.patch.object(notify.sys, 'argv', ['notify.py', '--dry-run']), \
                mock.patch.object(notify, 'send') as send, \
                contextlib.redirect_stdout(output):
            self.assertEqual(notify.main(), 0)
        send.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())['allowed_mentions'], {'parse': []})

    def test_missing_webhook_never_attempts_network(self):
        errors = io.StringIO()
        with mock.patch.object(notify.sys, 'argv', ['notify.py']), \
                mock.patch.object(notify, 'send') as send, \
                contextlib.redirect_stderr(errors):
            self.assertEqual(notify.main(), 1)
        send.assert_not_called()
        self.assertIn('missing or invalid', errors.getvalue())

    def test_transient_network_failure_has_bounded_retry(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = b'{"id":"12345"}'
        opener = mock.Mock()
        opener.open.side_effect = [urllib.error.URLError('test only'), response]
        with mock.patch.object(notify.urllib.request, 'build_opener', return_value=opener), \
                mock.patch.object(notify.time, 'sleep') as sleep, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(notify.send({'content': 'test'}, FAKE_WEBHOOK), 0)
        self.assertEqual(opener.open.call_count, 2)
        sleep.assert_called_once_with(1)
        self.assertTrue(all(call.kwargs['timeout'] == notify.REQUEST_TIMEOUT
                            for call in opener.open.call_args_list))

    def test_long_rate_limit_does_not_retry_early_or_leak_url(self):
        error = urllib.error.HTTPError(FAKE_WEBHOOK, 429, 'rate limit',
                                      {'Retry-After': '60'}, io.BytesIO(b'{}'))
        opener = mock.Mock()
        opener.open.side_effect = error
        errors = io.StringIO()
        with mock.patch.object(notify.urllib.request, 'build_opener', return_value=opener), \
                mock.patch.object(notify.time, 'sleep') as sleep, \
                contextlib.redirect_stderr(errors):
            self.assertEqual(notify.send({'content': 'test'}, FAKE_WEBHOOK), 1)
        self.assertEqual(opener.open.call_count, 1)
        sleep.assert_not_called()
        self.assertIn('HTTP 429', errors.getvalue())
        self.assertNotIn(FAKE_WEBHOOK, errors.getvalue())


if __name__ == '__main__':
    unittest.main()
