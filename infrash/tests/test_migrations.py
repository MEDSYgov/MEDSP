"""Behavioral tests for the migration safety boundary (no live database required)."""

import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("infrash_migrations", ROOT / "infrash/migrations.py")
MIGRATIONS = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MIGRATIONS
SPEC.loader.exec_module(MIGRATIONS)


class LexicalSafetyTests(unittest.TestCase):
    def test_function_bodies_and_nested_comments_do_not_become_transactions(self):
        sql = """
        /* outer /* COMMIT; */ remains */
        create or replace function public.example() returns text
        language plpgsql set search_path = '' as $body$
        begin return 'COMMIT; \\q'; end;
        $body$;
        -- ROLLBACK;
        select 'a''b; BEGIN;', E'escaped\\\'quote; COMMIT;';
        """
        MIGRATIONS.validate_sql(sql)
        self.assertEqual(2, len(MIGRATIONS.sql_statements(sql)))

    def test_all_accidental_transaction_boundaries_are_rejected(self):
        commands = ["BEGIN", "START TRANSACTION", "COMMIT", "END", "ROLLBACK", "ABORT", "SAVEPOINT x", "RELEASE x", "PREPARE TRANSACTION 'x'"]
        for command in commands:
            with self.subTest(command=command), self.assertRaises(MIGRATIONS.MigrationError) as captured:
                MIGRATIONS.validate_sql(f"select 1; /* comment */ {command};")
            self.assertEqual("TRANSACTION_CONTROL_FORBIDDEN", captured.exception.code)

    def test_real_psql_commands_are_rejected_even_without_leading_newline(self):
        for value in ["select 1; \\q", "\\connect other", "select 1 \\gexec", "COPY public.example FROM STDIN;\n\\."]:
            with self.subTest(value=value), self.assertRaises(MIGRATIONS.MigrationError) as captured:
                MIGRATIONS.validate_sql(value)
            self.assertEqual("PSQL_COMMAND_FORBIDDEN", captured.exception.code)

    def test_unterminated_sql_cannot_swallow_generated_ledger(self):
        for value in ["select 'unfinished", "select $body$unfinished", "select 1; /* unfinished", 'select "unfinished']:
            with self.subTest(value=value), self.assertRaises(MIGRATIONS.MigrationError) as captured:
                MIGRATIONS.validate_sql(value)
            self.assertEqual("SQL_LEXICAL_ERROR", captured.exception.code)

    def test_nontransactional_and_session_sql_get_explicit_errors(self):
        for value in ["create index concurrently idx on public.t(id);", "vacuum;", "create database example;", "alter system set work_mem='1MB';"]:
            with self.subTest(value=value), self.assertRaises(MIGRATIONS.MigrationError) as captured:
                MIGRATIONS.validate_sql(value)
            self.assertEqual("NONTRANSACTIONAL_SQL", captured.exception.code)
        for value in ["set standard_conforming_strings=off;", "reset all;", "discard all;"]:
            with self.subTest(value=value), self.assertRaises(MIGRATIONS.MigrationError) as captured:
                MIGRATIONS.validate_sql(value)
            self.assertEqual("SESSION_CONTROL_FORBIDDEN", captured.exception.code)

    def test_current_repository_history_passes(self):
        files = MIGRATIONS.load_inventory(ROOT / "supabase/migrations")
        self.assertGreaterEqual(len(files), 14)
        self.assertEqual("20260921082400", files[0].version)
        self.assertIn("20261011170000", [item.version for item in files])


class InventoryAndBaselineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)
        self.first = self.path / "20261024000100_first.sql"
        self.second = self.path / "20261024000200_second.sql"
        self.first.write_text("create table public.example(id integer);\n")
        self.second.write_text("alter table public.example add column name text;\n")

    def test_inventory_hashes_exact_bytes(self):
        inventory = MIGRATIONS.load_inventory(self.path)
        self.assertEqual(hashlib.sha256(self.first.read_bytes()).hexdigest(), inventory[0].sha256)
        self.assertEqual(3, len(inventory[0].tsv().split("\t")))

    def test_manifest_requires_exact_ordered_prefix(self):
        inventory = MIGRATIONS.load_inventory(self.path)
        manifest = self.path / "reviewed.tsv"
        manifest.write_text(inventory[0].tsv() + "\n")
        self.assertEqual(inventory[:1], MIGRATIONS.read_manifest(manifest, inventory))
        for lines in [inventory[1].tsv(), "\n".join(m.tsv() for m in reversed(inventory)), inventory[0].tsv().replace(inventory[0].sha256, "0" * 64), ""]:
            manifest.write_text(lines)
            with self.subTest(lines=lines), self.assertRaises(MIGRATIONS.MigrationError):
                MIGRATIONS.read_manifest(manifest, inventory)

    def test_edited_or_symlinked_migrations_are_not_silently_baselined(self):
        original = MIGRATIONS.load_inventory(self.path)
        manifest = self.path / "reviewed.tsv"
        manifest.write_text("\n".join(m.tsv() for m in original) + "\n")
        self.first.write_text("create table public.example(id bigint);\n")
        with self.assertRaises(MIGRATIONS.MigrationError):
            MIGRATIONS.read_manifest(manifest, MIGRATIONS.load_inventory(self.path))
        self.second.unlink()
        self.second.symlink_to(self.first)
        with self.assertRaises(MIGRATIONS.MigrationError) as captured:
            MIGRATIONS.load_inventory(self.path)
        self.assertEqual("INVALID_MIGRATION_FILENAME", captured.exception.code)

    def test_duplicate_versions_are_rejected(self):
        (self.path / "20261024000100_duplicate.sql").write_text("select 1;")
        with self.assertRaises(MIGRATIONS.MigrationError) as captured:
            MIGRATIONS.load_inventory(self.path)
        self.assertEqual("DUPLICATE_MIGRATION_VERSION", captured.exception.code)

    def test_baseline_without_acknowledgment_does_not_invoke_docker(self):
        report = self.path / "result.json"
        manifest = self.path / "reviewed.tsv"
        manifest.write_text(MIGRATIONS.load_inventory(self.path)[0].tsv())
        arguments = ["baseline", "--directory", str(self.path), "--container", "supabase-db", "--commit", "dff29b9", "--environment", "main", "--manifest", str(manifest), "--report", str(report)]
        with patch.object(MIGRATIONS, "execute_sql") as execute, contextlib.redirect_stderr(io.StringIO()):
            status = MIGRATIONS.main(arguments)
        self.assertEqual(1, status)
        execute.assert_not_called()
        self.assertEqual("BASELINE_REVIEW_REQUIRED", json.loads(report.read_text())["error_code"])
        self.assertEqual(0o600, report.stat().st_mode & 0o777)

    def test_wrong_target_argument_never_runs_docker(self):
        report = self.path / "result.json"
        arguments = ["apply", "--directory", str(self.path), "--container", "supabase-db", "--commit", "dff29b9", "--environment", "main", "--database", "postgresql://secret@example/db", "--report", str(report)]
        with patch.object(MIGRATIONS, "execute_sql") as execute, contextlib.redirect_stderr(io.StringIO()) as errors:
            status = MIGRATIONS.main(arguments)
        self.assertEqual(1, status)
        execute.assert_not_called()
        self.assertNotIn("secret", errors.getvalue())

    def test_generated_script_keeps_guards_and_ledger_inside_one_session(self):
        inventory = MIGRATIONS.load_inventory(self.path)
        sql = MIGRATIONS.build_sql(inventory, mode="apply", environment="staging", commit="dff29b9")
        lock_at = sql.index("pg_advisory_xact_lock")
        for guard in ["INFRASH_BASELINE_REQUIRED", "INFRASH_ENVIRONMENT_MISMATCH", "INFRASH_MISSING_APPLIED", "INFRASH_CHECKSUM_DRIFT", "INFRASH_OUT_OF_ORDER"]:
            self.assertGreater(sql.index(guard), lock_at)
            self.assertLess(sql.index(guard), sql.index("\\echo Applying"))
        self.assertIn("NOTIFY pgrst, 'reload schema';", sql)
        self.assertIn("is_baseline", sql)
        self.assertNotIn("supabase_migrations", sql)
        args = argparse.Namespace(container="supabase-db", database="postgres", username="supabase_admin")
        command = MIGRATIONS.docker_command(args)
        self.assertIn("--single-transaction", command)
        self.assertIn("ON_ERROR_STOP=1", command)
        self.assertIn("PGAPPNAME=medsp-infrash-migrate", command)
        self.assertEqual(["-f", "-"], command[-2:])

    def test_baseline_records_inventory_without_executing_its_sql(self):
        inventory = MIGRATIONS.load_inventory(self.path)
        sql = MIGRATIONS.build_sql(inventory, mode="baseline", baseline=inventory[:1], environment="main", commit="dff29b9")
        self.assertNotIn("create table public.example", sql)
        self.assertNotIn("alter table public.example", sql)
        self.assertIn("INFRASH_BASELINE_ALREADY_TRACKED", sql)
        self.assertIn("INFRASH_BASELINE_SCHEMA_MISSING", sql)


class DatabaseOutcomeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)
        self.args = argparse.Namespace(report=str(self.path / "migrations.json"), container="supabase-db", database="postgres", username="supabase_admin")

    def execute(self, returncode, output):
        class FakeDocker:
            def __init__(self, *args, **kwargs):
                self.returncode = returncode
                self.output = kwargs["stdout"]

            def communicate(self, _input):
                self.output.write(output.encode())
                self.output.flush()

        with patch.object(MIGRATIONS.subprocess, "Popen", FakeDocker):
            return MIGRATIONS.execute_sql(self.args, "select 1;", "RESULT:")

    def test_on_error_stop_exit_3_confirms_sql_rollback(self):
        with self.assertRaises(MIGRATIONS.MigrationError) as captured:
            self.execute(3, "psql:<stdin>:18: ERROR: INFRASH_ENVIRONMENT_MISMATCH\n")
        self.assertEqual("rolled_back", captured.exception.database_outcome)
        self.assertEqual("INFRASH_ENVIRONMENT_MISMATCH", captured.exception.code)

    def test_connection_loss_and_killed_client_are_unknown(self):
        for code in [2, 137, -15, 125]:
            with self.subTest(code=code), self.assertRaises(MIGRATIONS.MigrationError) as captured:
                self.execute(code, "client stopped\n")
            self.assertEqual("unknown", captured.exception.database_outcome)
            self.assertEqual("MIGRATION_RESULT_UNKNOWN", captured.exception.code)

    def test_connection_loss_after_sql_error_is_still_unknown(self):
        with self.assertRaises(MIGRATIONS.MigrationError) as captured:
            self.execute(3, "ERROR: timeout\nFATAL: terminating connection\n")
        self.assertEqual("unknown", captured.exception.database_outcome)

    def test_success_requires_zero_exit_and_unique_completion_marker(self):
        result = {"status": "ok", "applied": 1, "baseline": 0, "skipped": 2, "pending": 0, "total": 3}
        line = "RESULT:" + json.dumps(result) + "\n"
        success = self.execute(0, line)
        self.assertEqual("committed", success["database_outcome"])
        self.assertFalse(success["outcome_unknown"])
        self.assertEqual(0o600, (self.path / "migrations.private.log").stat().st_mode & 0o777)
        for code, output in [(0, ""), (0, line + line), (2, line)]:
            with self.subTest(code=code, output=output), self.assertRaises(MIGRATIONS.MigrationError) as captured:
                self.execute(code, output)
            self.assertEqual("unknown", captured.exception.database_outcome)

    def test_post_start_io_error_writes_unknown_report_without_secret(self):
        source = self.path / "sql"
        source.mkdir()
        (source / "20261024000100_first.sql").write_text("select 1;")
        arguments = ["apply", "--directory", str(source), "--container", "supabase-db", "--commit", "dff29b9", "--environment", "main", "--report", self.args.report]

        def fail_after_start(args, *_rest):
            args._backend_started = True
            raise OSError("secret from local error")

        with patch.object(MIGRATIONS, "execute_sql", side_effect=fail_after_start), contextlib.redirect_stderr(io.StringIO()) as errors:
            code = MIGRATIONS.main(arguments)
        self.assertEqual(1, code)
        self.assertNotIn("secret", errors.getvalue())
        result = json.loads(Path(self.args.report).read_text())
        self.assertEqual("unknown", result["database_outcome"])
        self.assertTrue(result["outcome_unknown"])


if __name__ == "__main__":
    unittest.main()
