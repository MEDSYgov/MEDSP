#!/usr/bin/env python3
"""Apply reviewed MEDSP SQL migrations through the existing PostgreSQL container.

The custom ledger is deliberately separate from Supabase CLI migration history.
All pending migration statements and their ledger records share one transaction.
This lexical guard prevents accidental transaction boundaries; it is not a
sandbox for untrusted SQL. Committers are trusted database administrators.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import uuid


FILENAME = re.compile(r"^(\d{14})_([A-Za-z0-9][A-Za-z0-9_-]*)\.sql$")
DOLLAR_QUOTE = re.compile(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$")
SQL_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$-]{0,62}$")
CONTAINER_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
COMMIT = re.compile(r"^[0-9a-fA-F]{7,64}$")
TRANSACTION_COMMANDS = {
    "ABORT", "BEGIN", "COMMIT", "END", "PREPARE", "RELEASE",
    "ROLLBACK", "SAVEPOINT", "START",
}
KNOWN_DATABASE_ERRORS = {
    "INFRASH_BASELINE_REQUIRED", "INFRASH_BASELINE_SCHEMA_MISSING",
    "INFRASH_BASELINE_ALREADY_TRACKED", "INFRASH_TARGET_MISSING",
    "INFRASH_ENVIRONMENT_MISMATCH", "INFRASH_MISSING_APPLIED",
    "INFRASH_CHECKSUM_DRIFT", "INFRASH_OUT_OF_ORDER",
}


class MigrationError(Exception):
    def __init__(self, code: str, message: str, database_outcome: str | None = None):
        super().__init__(message)
        self.code = code
        self.database_outcome = database_outcome


class RunInterrupted(Exception):
    pass


@dataclass(frozen=True)
class Migration:
    version: str
    filename: str
    sha256: str
    sql: str

    def tsv(self) -> str:
        return f"{self.version}\t{self.filename}\t{self.sha256}"


def sql_statements(sql: str) -> list[list[str]]:
    """Tokenize statement boundaries without reading inside SQL literal bodies.

    Handles doubled quotes, E-strings, dollar quotes, line comments, and nested
    block comments. Backslashes outside quoted text are forbidden because psql
    would interpret them as client commands (including \\q and \\connect).
    """
    statements: list[list[str]] = []
    current: list[str] = []
    i, length = 0, len(sql)
    while i < length:
        char = sql[i]
        if char.isspace():
            i += 1
            continue
        if sql.startswith("--", i):
            newline = sql.find("\n", i + 2)
            i = length if newline < 0 else newline + 1
            continue
        if sql.startswith("/*", i):
            depth = 1
            i += 2
            while i < length and depth:
                if sql.startswith("/*", i):
                    depth += 1
                    i += 2
                elif sql.startswith("*/", i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            if depth:
                raise MigrationError("SQL_LEXICAL_ERROR", "Unterminated SQL block comment.")
            continue
        if char == "\\":
            raise MigrationError("PSQL_COMMAND_FORBIDDEN", "psql backslash commands are not permitted in migration files.")
        if char in ("'", '"'):
            quote = char
            escaped = (
                quote == "'" and i > 0 and sql[i - 1] in "Ee"
                and (i < 2 or not (sql[i - 2].isalnum() or sql[i - 2] in "_$"))
            )
            i += 1
            closed = False
            while i < length:
                if escaped and sql[i] == "\\":
                    i += 2
                elif sql[i] == quote:
                    if i + 1 < length and sql[i + 1] == quote:
                        i += 2
                    else:
                        i += 1
                        closed = True
                        break
                else:
                    i += 1
            if not closed:
                raise MigrationError("SQL_LEXICAL_ERROR", "Unterminated SQL quoted value.")
            current.append("<quoted>")
            continue
        if char == "$":
            match = DOLLAR_QUOTE.match(sql, i)
            if match:
                delimiter = match.group(0)
                close = sql.find(delimiter, match.end())
                if close < 0:
                    raise MigrationError("SQL_LEXICAL_ERROR", "Unterminated SQL dollar-quoted body.")
                current.append("<body>")
                i = close + len(delimiter)
                continue
        if char == ";":
            if current:
                statements.append(current)
                current = []
            i += 1
            continue
        if char.isalpha() or char == "_":
            end = i + 1
            while end < length and (sql[end].isalnum() or sql[end] in "_$"):
                end += 1
            current.append(sql[i:end].upper())
            i = end
            continue
        current.append(char)
        i += 1
    if current:
        statements.append(current)
    return statements


def validate_sql(sql: str, filename: str = "migration.sql") -> None:
    if "\x00" in sql or sql.startswith("\ufeff"):
        raise MigrationError("SQL_ENCODING_ERROR", f"{filename}: use UTF-8 without BOM or NUL characters.")
    try:
        statements = sql_statements(sql)
    except MigrationError as exc:
        raise MigrationError(exc.code, f"{filename}: {exc}") from exc
    if not statements:
        raise MigrationError("EMPTY_MIGRATION", f"{filename}: no SQL statements were found.")
    for tokens in statements:
        first = tokens[0]
        if first in TRANSACTION_COMMANDS:
            raise MigrationError("TRANSACTION_CONTROL_FORBIDDEN", f"{filename}: top-level {first} is not permitted.")
        # Session settings can change SQL string parsing or defeat runner limits.
        # Put function-local SET clauses inside CREATE FUNCTION as usual.
        if first in {"SET", "RESET", "DISCARD"}:
            raise MigrationError("SESSION_CONTROL_FORBIDDEN", f"{filename}: top-level {first} is managed by the runner.")
        if "CONCURRENTLY" in tokens or first in {"VACUUM", "CLUSTER"}:
            raise MigrationError("NONTRANSACTIONAL_SQL", f"{filename}: this operation requires a separately reviewed maintenance procedure.")
        if tokens[:2] in (["CREATE", "DATABASE"], ["DROP", "DATABASE"], ["ALTER", "SYSTEM"]):
            raise MigrationError("NONTRANSACTIONAL_SQL", f"{filename}: cluster-level operations are not application migrations.")


def load_inventory(directory: Path) -> list[Migration]:
    if not directory.is_dir() or directory.is_symlink():
        raise MigrationError("MIGRATION_DIRECTORY_MISSING", "The migration directory must exist and must not be a symlink.")
    migrations: list[Migration] = []
    versions: set[str] = set()
    for path in sorted(directory.iterdir(), key=lambda item: item.name):
        if path.is_dir():
            raise MigrationError("NESTED_MIGRATIONS", "The migration directory must be flat; move SQL files out of subdirectories.")
        if path.suffix.lower() != ".sql":
            continue
        match = FILENAME.fullmatch(path.name)
        if path.is_symlink() or not path.is_file() or not match:
            raise MigrationError("INVALID_MIGRATION_FILENAME", "SQL filenames must be regular files named YYYYMMDDHHMMSS_description.sql.")
        version = match.group(1)
        try:
            datetime.strptime(version, "%Y%m%d%H%M%S")
        except ValueError as exc:
            raise MigrationError("INVALID_MIGRATION_VERSION", f"{path.name}: the timestamp is invalid.") from exc
        if version in versions:
            raise MigrationError("DUPLICATE_MIGRATION_VERSION", f"Duplicate migration version: {version}.")
        versions.add(version)
        content = path.read_bytes()
        try:
            sql = content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise MigrationError("SQL_ENCODING_ERROR", f"{path.name}: the migration must be UTF-8.") from exc
        validate_sql(sql, path.name)
        migrations.append(Migration(version, path.name, hashlib.sha256(content).hexdigest(), sql))
    if not migrations:
        raise MigrationError("NO_MIGRATIONS", "No migration files were found; refusing an empty migration history.")
    return migrations


def read_manifest(path: Path, migrations: list[Migration]) -> list[Migration]:
    if not path.is_absolute() or not path.is_file() or path.is_symlink():
        raise MigrationError("INVALID_BASELINE_MANIFEST", "Use an absolute path to a regular reviewed baseline TSV file.")
    try:
        lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")]
    except (OSError, UnicodeError) as exc:
        raise MigrationError("INVALID_BASELINE_MANIFEST", "The reviewed baseline manifest could not be read as UTF-8.") from exc
    if not lines or len(lines) > len(migrations):
        raise MigrationError("INVALID_BASELINE_MANIFEST", "The baseline must contain a non-empty ordered prefix of the local inventory.")
    prefix = migrations[:len(lines)]
    if lines != [item.tsv() for item in prefix]:
        raise MigrationError("BASELINE_MANIFEST_MISMATCH", "The reviewed baseline must exactly match a version/filename/SHA-256 prefix of this checkout.")
    return prefix


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def build_sql(
    migrations: list[Migration], *, mode: str, environment: str, commit: str,
    baseline: list[Migration] | None = None, statement_timeout: int = 600000,
    result_marker: str = "INFRASH_REPORT:",
) -> str:
    """Build a single psql transaction; every state assertion stays under its lock."""
    approved = baseline or []
    parts = [
        "SET LOCAL standard_conforming_strings = on;",
        "SET LOCAL lock_timeout = '30000ms';",
        f"SET LOCAL statement_timeout = '{statement_timeout}ms';",
        "SET LOCAL idle_in_transaction_session_timeout = '60000ms';",
        "SELECT pg_catalog.pg_advisory_xact_lock(1296385107, 1);",
    ]
    if mode == "apply":
        parts.append("""
DO $infrash_initial$
BEGIN
  IF pg_catalog.to_regclass('infrash.schema_migrations') IS NULL
     AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_depend d
           WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
             AND d.objid = c.oid AND d.deptype = 'e'
         )
     ) THEN
    RAISE EXCEPTION 'INFRASH_BASELINE_REQUIRED';
  END IF;
  IF pg_catalog.to_regclass('infrash.schema_migrations') IS NOT NULL
     AND pg_catalog.to_regclass('infrash.deployment_target') IS NULL THEN
    RAISE EXCEPTION 'INFRASH_TARGET_MISSING';
  END IF;
END;
$infrash_initial$;
""")
    else:
        parts.append("""
DO $infrash_baseline_schema$
BEGIN
  IF pg_catalog.to_regclass('auth.users') IS NULL
     OR pg_catalog.to_regclass('public.admins') IS NULL
     OR pg_catalog.to_regclass('public.projects') IS NULL
     OR pg_catalog.to_regclass('public.surveys') IS NULL
     OR pg_catalog.to_regclass('public.responses') IS NULL THEN
    RAISE EXCEPTION 'INFRASH_BASELINE_SCHEMA_MISSING';
  END IF;
END;
$infrash_baseline_schema$;
""")
    parts.append("""
CREATE SCHEMA IF NOT EXISTS infrash;
REVOKE ALL ON SCHEMA infrash FROM PUBLIC;
CREATE TABLE IF NOT EXISTS infrash.schema_migrations (
  version text PRIMARY KEY,
  filename text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  commit_sha text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  is_baseline boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS infrash.deployment_target (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL CHECK (environment IN ('main', 'staging'))
);
REVOKE ALL ON infrash.schema_migrations, infrash.deployment_target FROM PUBLIC;
DO $infrash_privileges$
DECLARE api_role text;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_catalog.pg_roles
                 WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA infrash FROM %I', api_role);
    EXECUTE pg_catalog.format('REVOKE ALL ON ALL TABLES IN SCHEMA infrash FROM %I', api_role);
  END LOOP;
END;
$infrash_privileges$;
CREATE TEMP TABLE _infrash_expected (
  version text PRIMARY KEY, filename text NOT NULL, sha256 text NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE _infrash_applied (
  version text PRIMARY KEY, is_baseline boolean NOT NULL
) ON COMMIT DROP;
""")
    parts.append(
        "INSERT INTO infrash.deployment_target (singleton, environment) VALUES (true, "
        + sql_literal(environment) + ") ON CONFLICT (singleton) DO NOTHING;"
    )
    parts.append("""
DO $infrash_target$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM infrash.deployment_target
                 WHERE singleton AND environment = %s) THEN
    RAISE EXCEPTION 'INFRASH_ENVIRONMENT_MISMATCH';
  END IF;
END;
$infrash_target$;
""" % sql_literal(environment))
    expected = ",\n".join(
        "(" + ",".join(sql_literal(value) for value in (m.version, m.filename, m.sha256)) + ")"
        for m in migrations
    )
    parts.append("INSERT INTO pg_temp._infrash_expected (version, filename, sha256) VALUES\n" + expected + ";")
    parts.append("""
DO $infrash_history$
BEGIN
  IF EXISTS (
    SELECT 1 FROM infrash.schema_migrations h
    LEFT JOIN pg_temp._infrash_expected e USING (version)
    WHERE e.version IS NULL
  ) THEN
    RAISE EXCEPTION 'INFRASH_MISSING_APPLIED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM infrash.schema_migrations h
    JOIN pg_temp._infrash_expected e USING (version)
    WHERE h.sha256 <> e.sha256 OR h.filename <> e.filename
  ) THEN
    RAISE EXCEPTION 'INFRASH_CHECKSUM_DRIFT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp._infrash_expected e
    WHERE NOT EXISTS (SELECT 1 FROM infrash.schema_migrations h WHERE h.version = e.version)
      AND e.version < (SELECT pg_catalog.max(h.version) FROM infrash.schema_migrations h)
  ) THEN
    RAISE EXCEPTION 'INFRASH_OUT_OF_ORDER';
  END IF;
END;
$infrash_history$;
""")
    if mode == "baseline":
        parts.append("""
DO $infrash_baseline_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM infrash.schema_migrations) THEN
    RAISE EXCEPTION 'INFRASH_BASELINE_ALREADY_TRACKED';
  END IF;
END;
$infrash_baseline_guard$;
""")
        for item in approved:
            parts.extend(ledger_insert(item, commit, is_baseline=True))
    else:
        for item in migrations:
            parts.extend([
                "SELECT NOT EXISTS (SELECT 1 FROM infrash.schema_migrations WHERE version = "
                + sql_literal(item.version) + ") AS infrash_pending \\gset",
                "\\if :infrash_pending",
                "\\echo Applying " + item.filename,
                item.sql + "\n;",  # Separate a missing final semicolon / trailing line comment.
                *ledger_insert(item, commit, is_baseline=False),
                "\\endif",
            ])
        parts.append("NOTIFY pgrst, 'reload schema';")
    parts.append("""
SELECT %s || pg_catalog.json_build_object(
  'status', 'ok', 'mode', %s, 'environment', %s, 'commit', %s,
  'applied', (SELECT count(*) FROM pg_temp._infrash_applied WHERE NOT is_baseline),
  'baseline', (SELECT count(*) FROM pg_temp._infrash_applied WHERE is_baseline),
  'skipped', (SELECT count(*) FROM infrash.schema_migrations)
             - (SELECT count(*) FROM pg_temp._infrash_applied),
  'pending', (SELECT count(*) FROM pg_temp._infrash_expected)
             - (SELECT count(*) FROM infrash.schema_migrations),
  'total', (SELECT count(*) FROM pg_temp._infrash_expected),
  'database', pg_catalog.current_database(),
  'server_version', pg_catalog.current_setting('server_version')
)::text;
""" % (sql_literal(result_marker), sql_literal(mode), sql_literal(environment), sql_literal(commit)))
    return "\n".join(parts) + "\n"


def ledger_insert(item: Migration, commit: str, *, is_baseline: bool) -> list[str]:
    values = ",".join(sql_literal(value) for value in (item.version, item.filename, item.sha256, commit))
    flag = "true" if is_baseline else "false"
    return [
        "INSERT INTO infrash.schema_migrations (version, filename, sha256, commit_sha, is_baseline) VALUES ("
        + values + "," + flag + ");",
        "INSERT INTO pg_temp._infrash_applied (version, is_baseline) VALUES ("
        + sql_literal(item.version) + "," + flag + ");",
    ]


def atomic_json(path: Path, document: dict) -> None:
    if not path.is_absolute():
        raise MigrationError("INVALID_REPORT_PATH", "The report path must be absolute.")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=".infrash-report-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(document, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def docker_command(args: argparse.Namespace) -> list[str]:
    return [
        "docker", "exec", "-i", "-e", "PGAPPNAME=medsp-infrash-migrate",
        args.container, "psql", "-X", "-v", "ON_ERROR_STOP=1",
        "--single-transaction", "-qAt", "-U", args.username,
        "-d", args.database, "-f", "-",
    ]


def execute_sql(args: argparse.Namespace, script: str, marker: str) -> dict:
    report = Path(args.report)
    if not report.is_absolute():
        raise MigrationError("INVALID_REPORT_PATH", "The report path must be absolute.")
    report.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    private_log = report.with_name(report.stem + ".private.log")
    # Never follow an existing symlink when writing potentially sensitive output.
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(private_log, flags, 0o600)
    os.fchmod(descriptor, 0o600)
    process: subprocess.Popen | None = None
    previous = {}

    def interrupted(_signum, _frame):
        raise RunInterrupted()

    try:
        for signum in (signal.SIGTERM, signal.SIGINT):
            previous[signum] = signal.signal(signum, interrupted)
        with os.fdopen(descriptor, "wb") as output:
            process = subprocess.Popen(docker_command(args), stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT)
            args._backend_started = True
            try:
                process.communicate(script.encode("utf-8"))
            except RunInterrupted:
                # Killing docker's client is not proof that PostgreSQL rolled back.
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                raise
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)

    log = private_log.read_text(encoding="utf-8", errors="replace")
    if process is None or process.returncode != 0:
        lost_connection = any(fragment in log.lower() for fragment in (
            "connection to server was lost", "server closed the connection unexpectedly",
            "could not send", "terminating connection", "fatal:", "broken pipe",
        ))
        if process is not None and process.returncode == 3 and "ERROR:" in log and not lost_connection:
            # psql documents exit 3 for ON_ERROR_STOP. With -1 it issues ROLLBACK.
            error_code = next((code for code in sorted(KNOWN_DATABASE_ERRORS) if code in log), "MIGRATION_SQL_FAILED")
            args._database_outcome = "rolled_back"
            raise MigrationError(error_code, "Database migration failed and its transaction rolled back. Review the private migration log on the application server.", "rolled_back")
        raise MigrationError("MIGRATION_RESULT_UNKNOWN", "The Docker/PostgreSQL client stopped without a confirmed database result; inspect active sessions and history before recovery.", "unknown")
    matches = [line[len(marker):] for line in log.splitlines() if line.startswith(marker)]
    if len(matches) != 1:
        raise MigrationError("MIGRATION_RESULT_UNKNOWN", "The migration command returned without a unique completion report; inspect database history before retrying.", "unknown")
    try:
        result = json.loads(matches[0])
    except json.JSONDecodeError as exc:
        raise MigrationError("MIGRATION_RESULT_UNKNOWN", "The migration completion report was invalid; inspect database history before retrying.", "unknown") from exc
    if result.get("status") != "ok" or any(not isinstance(result.get(key), int) for key in ("applied", "baseline", "skipped", "pending", "total")):
        raise MigrationError("MIGRATION_RESULT_UNKNOWN", "The migration completion report was incomplete; inspect database history before retrying.", "unknown")
    args._database_outcome = "committed"
    result["database_outcome"] = "committed"
    result["outcome_unknown"] = False
    return result


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    for command in ("validate", "inventory", "apply", "baseline"):
        sub = commands.add_parser(command)
        sub.add_argument("--directory", type=Path, required=True)
        if command in {"apply", "baseline"}:
            sub.add_argument("--container", required=True)
            sub.add_argument("--database", default="postgres")
            sub.add_argument("--username", default="supabase_admin")
            sub.add_argument("--environment", choices=("main", "staging"), required=True)
            sub.add_argument("--commit", required=True)
            sub.add_argument("--report", required=True)
            sub.add_argument("--statement-timeout", type=int, default=600000, help="Per-statement timeout in milliseconds (default: 600000).")
        if command == "baseline":
            sub.add_argument("--manifest", type=Path, required=True)
            sub.add_argument("--acknowledge-reviewed-schema", action="store_true")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    report = Path(args.report) if hasattr(args, "report") else None
    total = 0
    try:
        migrations = load_inventory(args.directory)
        total = len(migrations)
        if args.command == "validate":
            print(f"Validated {total} SQL migration files.")
            return 0
        if args.command == "inventory":
            print("\n".join(item.tsv() for item in migrations))
            return 0
        if not CONTAINER_NAME.fullmatch(args.container):
            raise MigrationError("INVALID_CONTAINER", "Invalid Docker container name.")
        if not SQL_IDENTIFIER.fullmatch(args.database) or not SQL_IDENTIFIER.fullmatch(args.username):
            raise MigrationError("INVALID_DATABASE_TARGET", "Database and username must be simple identifiers, not connection strings.")
        if not COMMIT.fullmatch(args.commit):
            raise MigrationError("INVALID_COMMIT", "Use a hexadecimal Git commit identifier.")
        if not 1000 <= args.statement_timeout <= 3600000:
            raise MigrationError("INVALID_STATEMENT_TIMEOUT", "The per-statement timeout must be 1000–3600000 milliseconds.")
        if report is None or not report.is_absolute():
            raise MigrationError("INVALID_REPORT_PATH", "The report path must be absolute.")
        approved = None
        if args.command == "baseline":
            if not args.acknowledge_reviewed_schema:
                raise MigrationError("BASELINE_REVIEW_REQUIRED", "Baseline requires --acknowledge-reviewed-schema after schema and manifest review.")
            approved = read_manifest(args.manifest, migrations)
        marker = "INFRASH_REPORT_" + uuid.uuid4().hex + ":"
        script = build_sql(
            migrations, mode=args.command, environment=args.environment,
            commit=args.commit.lower(), baseline=approved,
            statement_timeout=args.statement_timeout, result_marker=marker,
        )
        result = execute_sql(args, script, marker)
        atomic_json(report, result)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except RunInterrupted:
        result = {"status": "interrupted", "error_code": "MIGRATION_INTERRUPTED", "mode": args.command,
                  "total": total, "database_outcome": "unknown", "outcome_unknown": True}
        if report is not None and report.is_absolute():
            atomic_json(report, result)
        print("ERROR [MIGRATION_INTERRUPTED] Database outcome is unknown; inspect active medsp-infrash-migrate sessions and migration history before recovery.", file=sys.stderr)
        return 130
    except (MigrationError, OSError) as exc:
        started = getattr(args, "_backend_started", False)
        code = exc.code if isinstance(exc, MigrationError) else ("MIGRATION_RESULT_UNKNOWN" if started else "MIGRATION_LOCAL_IO_ERROR")
        outcome = exc.database_outcome if isinstance(exc, MigrationError) else None
        outcome = outcome or ("unknown" if started else "not_started")
        result = {"status": "error", "error_code": code, "mode": args.command, "total": total,
                  "database_outcome": outcome, "outcome_unknown": outcome == "unknown"}
        if report is not None and report.is_absolute():
            try:
                atomic_json(report, result)
            except OSError:
                pass
        detail = str(exc) if isinstance(exc, MigrationError) else "A required local file, Docker executable, or process could not be accessed."
        print(f"ERROR [{code}] {detail}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
