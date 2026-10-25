"""Offline behavioral checks for MEDSP Bash recovery and notification entrypoints.

Every test copies the scripts into a temporary workspace, uses temporary
configuration/state, and records calls through a fake Docker executable. The
fake never delegates to a real daemon. No database, container or webhook is used.
"""

import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest


REPO = Path(__file__).resolve().parents[2]
BASH = shutil.which('bash')


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='medsp-workflow-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.workspace = self.root / 'workspace'
        self.scripts = self.workspace / 'infrash'
        self.scripts.mkdir(parents=True)
        for filename in ('common.bash', 'deploy.sh', 'verification.sh', 'notify.py'):
            shutil.copyfile(REPO / 'infrash' / filename, self.scripts / filename)

        self.fake_bin = self.root / 'bin'
        self.fake_bin.mkdir()
        self.docker_log = self.root / 'docker.jsonl'
        fake = self.fake_bin / 'docker'
        fake.write_text(f'#!{sys.executable}\n' + textwrap.dedent('''\
            import json, os, sys
            args = sys.argv[1:]
            with open(os.environ['FAKE_DOCKER_LOG'], 'a', encoding='utf-8') as f:
                f.write(json.dumps(args) + '\\n')
            if args and args[0] == 'compose':
                if 'ps' in args and '-aq' in args:
                    print('candidate-container')
                    raise SystemExit(0)
                if 'stop' in args or 'up' in args:
                    raise SystemExit(0)
            if args and args[0] == 'inspect':
                if '{{.Image}}' in args:
                    print(os.environ.get('FAKE_IMAGE_ID', 'sha256:expected-image'))
                    raise SystemExit(0)
                if '{{.State.Health.Status}}' in args:
                    print('healthy')
                    raise SystemExit(0)
            if args and args[0] == 'start':
                print(args[-1])
                raise SystemExit(0)
            if args and args[0] == 'exec' and 'psql' in args and '-c' in args:
                query = args[args.index('-c') + 1]
                if 'pg_stat_activity' in query:
                    print(os.environ.get('FAKE_ACTIVE_MIGRATIONS', '0'))
                    raise SystemExit(0)
            if args and args[0] == 'exec' and 'node' in args:
                raise SystemExit(0)
            print('UNEXPECTED FAKE DOCKER CALL', file=sys.stderr)
            raise SystemExit(90)
        '''), encoding='utf-8')
        fake.chmod(0o700)

        self.run_id = 'staging-13-aaaaaaaaaaaa'
        self.deploy_root = self.root / 'deployment'
        self.run_dir = self.deploy_root / 'runs' / self.run_id
        self.release = self.deploy_root / 'releases' / self.run_id
        self.run_dir.mkdir(parents=True)
        (self.release / 'source' / 'infrash').mkdir(parents=True)
        self.state_file = self.run_dir / 'state.json'
        self.marker = self.deploy_root / 'deployment-incomplete'
        self.marker.write_text(self.run_id + '\n', encoding='utf-8')
        self.current = self.deploy_root / 'current'
        self.current.symlink_to(self.release)
        self.release.joinpath('release.json').write_text(json.dumps({
            'image': 'local/medsp:candidate', 'project': 'medsp-staging',
            'port': '3001', 'bind': '127.0.0.1',
        }), encoding='utf-8')
        self.state = {
            'status': 'FAILURE', 'migration_status': 'complete',
            'migration_count': '0', 'activation_started': 'true',
            'previous_release': '', 'previous_container': 'legacy-medsp',
            'image_id': 'sha256:expected-image', 'deployment_status': 'activated',
            'verification_status': 'pending', 'rollback_status': 'not_attempted',
            'error_summary': 'Original deployment error.',
        }
        self.write_state()
        self.config = self.root / 'staging.conf'
        self.app_env = self.root / 'application.env'
        self.app_env.write_text('# No real credentials.\n', encoding='utf-8')
        self.app_env.chmod(0o600)
        self.config_values = {
            'TARGET_BRANCH': 'staging',
            'DEPLOY_ROOT': str(self.deploy_root),
            'BACKUP_ROOT': str(self.root / 'backups'),
            'APP_ENV_FILE': str(self.app_env),
            'APP_PROJECT': 'medsp-staging',
            'APP_PORT': '3001',
            'APP_BIND_IP': '127.0.0.1',
            'DB_CONTAINER': 'fake-database',
            'DB_NAME': 'postgres',
            'DB_USER': 'supabase_admin',
            'SUPABASE_STORAGE_MODE': 'unused',
            'MIGRATIONS_BACKWARD_COMPATIBLE': 'false',
            'WAIT_SECONDS': '2',
        }
        self.write_config()
        self.env = {
            'PATH': str(self.fake_bin) + os.pathsep + os.defpath,
            'LANG': 'C.UTF-8',
            'PYTHONDONTWRITEBYTECODE': '1',
            'FAKE_DOCKER_LOG': str(self.docker_log),
            'INFRASH_CONFIG': str(self.config),
            'INFRASH_RUN_ID': self.run_id,
            'BRANCH_NAME': 'staging',
        }

    def write_config(self, mode=0o600):
        self.config.write_text(''.join(
            f'{key}={shlex.quote(value)}\n' for key, value in self.config_values.items()
        ), encoding='utf-8')
        self.config.chmod(mode)

    def write_state(self, **changes):
        self.state.update(changes)
        self.state_file.write_text(json.dumps(self.state), encoding='utf-8')
        self.state_file.chmod(0o600)

    def state_after(self):
        return json.loads(self.state_file.read_text(encoding='utf-8'))

    def docker_calls(self):
        if not self.docker_log.exists():
            return []
        return [json.loads(line) for line in self.docker_log.read_text().splitlines()]

    def run_entrypoint(self, script, *args, overrides=None, unset=()):
        env = self.env.copy()
        env.update(overrides or {})
        for key in unset:
            env.pop(key, None)
        return subprocess.run([BASH, str(self.scripts / script), *args],
                              cwd=self.workspace, env=env, text=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=12, check=False)

    def assert_manual_no_activation(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.state_after()['rollback_status'], 'manual_required')
        self.assertEqual(self.docker_calls(), [])
        self.assertTrue(self.marker.exists())
        self.assertEqual(self.state_after()['status'], 'FAILURE')

    def test_running_or_unknown_migration_requires_manual_recovery(self):
        for outcome in ('running', 'unknown'):
            with self.subTest(outcome=outcome):
                self.write_state(migration_status=outcome)
                self.assert_manual_no_activation(self.run_entrypoint('deploy.sh', 'rollback'))

    def test_invalid_count_blocks_recovery_even_with_compatibility_assertion(self):
        self.config_values['MIGRATIONS_BACKWARD_COMPATIBLE'] = 'true'
        self.write_config()
        for count in ('unknown', '', '-1', '1.5', 'true'):
            with self.subTest(count=count):
                self.write_state(migration_count=count)
                self.assert_manual_no_activation(self.run_entrypoint('deploy.sh', 'rollback'))

    def test_nonzero_migrations_without_compatibility_block_recovery(self):
        self.write_state(migration_count='2')
        self.assert_manual_no_activation(self.run_entrypoint('deploy.sh', 'rollback'))

    def test_nonzero_decimal_counts_cannot_bypass_compatibility_guard(self):
        # Shell arithmetic must not reinterpret accepted decimal strings as octal
        # or overflow them into zero/negative values when deciding rollback safety.
        for count in ('08', '9999999999999999999999999999999999999'):
            with self.subTest(count=count):
                self.write_state(migration_count=count)
                self.assert_manual_no_activation(self.run_entrypoint('deploy.sh', 'rollback'))

    def test_zero_count_restores_existing_container_and_clears_own_marker(self):
        # First takeover failed before a managed current pointer was published.
        self.current.unlink()
        result = self.run_entrypoint('deploy.sh', 'rollback')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        state = self.state_after()
        self.assertEqual(state['rollback_status'], 'restored')
        self.assertEqual(state['status'], 'FAILURE')
        self.assertFalse(self.marker.exists())
        self.assertFalse(self.current.is_symlink())
        calls = self.docker_calls()
        stop = next(i for i, call in enumerate(calls)
                    if call[0] == 'compose' and call[-2:] == ['stop', 'medsp'])
        start = calls.index(['start', 'legacy-medsp'])
        probe = next(i for i, call in enumerate(calls)
                     if call[:3] == ['exec', 'legacy-medsp', 'node'])
        self.assertLess(stop, start)
        self.assertLess(start, probe)
        self.assertIn('/healthz', ' '.join(calls[probe]))

    def test_verified_failure_stays_failed_after_successful_app_rollback(self):
        result = self.run_entrypoint('verification.sh', 'check', overrides={
            'FAKE_IMAGE_ID': 'sha256:unexpected-image',
        })
        self.assertNotEqual(result.returncode, 0)
        state = self.state_after()
        self.assertEqual(state['status'], 'FAILURE')
        self.assertEqual(state['verification_status'], 'failed')
        self.assertEqual(state['rollback_status'], 'restored')
        report = json.loads(self.workspace.joinpath('.infrash-report.json').read_text())
        self.assertEqual(report['status'], 'FAILURE')
        self.assertEqual(report['rollback_status'], 'restored')
        self.assertFalse(self.marker.exists())

    def test_no_previous_application_marks_recovery_unavailable(self):
        self.write_state(previous_container='', previous_release='')
        result = self.run_entrypoint('deploy.sh', 'rollback')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.state_after()['rollback_status'], 'unavailable')
        self.assertTrue(self.marker.exists())
        self.assertFalse(any(call[0] in ('start', 'compose') for call in self.docker_calls()))

    def test_different_run_marker_refuses_stale_recovery(self):
        newer = 'staging-14-bbbbbbbbbbbb'
        self.marker.write_text(newer + '\n', encoding='utf-8')
        result = self.run_entrypoint('deploy.sh', 'rollback')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('refusing stale recovery', result.stderr)
        self.assertEqual(self.marker.read_text().strip(), newer)
        self.assertEqual(self.current.resolve(), self.release)
        self.assertEqual(self.docker_calls(), [])

    def test_newer_current_pointer_refuses_stale_recovery(self):
        newer = self.deploy_root / 'releases' / 'newer-release'
        newer.mkdir()
        self.current.unlink()
        self.current.symlink_to(newer)
        result = self.run_entrypoint('deploy.sh', 'rollback')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('refusing stale recovery', result.stderr)
        self.assertEqual(self.current.resolve(), newer)
        self.assertTrue(self.marker.exists())
        self.assertEqual(self.docker_calls(), [])

    def test_missing_marker_allows_only_current_run_recovery(self):
        self.marker.unlink()
        self.current.unlink()
        result = self.run_entrypoint('deploy.sh', 'rollback')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('currently active run', result.stderr)
        self.assertEqual(self.docker_calls(), [])

    def test_config_branch_mismatch_fails_before_docker(self):
        before = self.state_file.read_text()
        result = self.run_entrypoint('deploy.sh', 'rollback', overrides={'BRANCH_NAME': 'main'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Branch/config mismatch', result.stderr)
        self.assertEqual(self.docker_calls(), [])
        self.assertEqual(self.state_file.read_text(), before)

    def test_group_or_world_writable_config_is_rejected(self):
        for mode in (0o660, 0o602, 0o666):
            with self.subTest(mode=oct(mode)):
                self.write_config(mode)
                result = self.run_entrypoint('deploy.sh', 'rollback')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('not group/world writable', result.stderr)
                self.assertEqual(self.docker_calls(), [])

    def test_notify_without_config_reaches_safe_fallback(self):
        result = self.run_entrypoint('verification.sh', 'notify',
                                    unset=('INFRASH_CONFIG', 'INFRASH_RUN_ID'),
                                    overrides={'DEPLOY_RESULT': 'FAILURE', 'LAST_PHASE': 'Checkout'})
        self.assertEqual(result.returncode, 1)  # Missing webhook; no network attempt.
        self.assertIn('Discord webhook is missing or invalid', result.stderr)
        self.assertNotIn('Traceback', result.stderr)
        self.assertNotIn('Set INFRASH_CONFIG', result.stderr)
        self.assertEqual(self.docker_calls(), [])


if __name__ == '__main__':
    unittest.main()
