"""Read-only export of the fixed ParkShare-QA source; encrypt before upload."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import parse_qsl, unquote, urlsplit
import re

SOURCE_REF = "biydlfekindgaslgktsx"
CLI_VERSION = "2.122.0"


def validate_source(value):
    try:
        url = urlsplit(value)
        username = unquote(url.username or "")
        direct = url.hostname == f"db.{SOURCE_REF}.supabase.co" and username == "postgres"
        pooler = bool(re.fullmatch(r"aws-\d+-ca-central-1\.pooler\.supabase\.com", url.hostname or "")) and username == f"postgres.{SOURCE_REF}"
        options = parse_qsl(url.query, keep_blank_values=True)
        valid = (
            url.scheme in ("postgres", "postgresql")
            and (direct or pooler)
            and url.port in (None, 5432)
            and url.path == "/postgres"
            and bool(url.password)
            and "[" not in unquote(url.password)
            and not url.fragment
            and not any(c in value for c in "\r\n\x00")
            and all(k == "sslmode" and v in ("require", "verify-ca", "verify-full") for k, v in options)
            and len(options) <= 1
        )
        if not valid:
            raise ValueError
        return value + ("" if options else "?sslmode=require")
    except (ValueError, TypeError):
        raise ValueError("A credentialed direct or session-pooler URL for the original QA project is required; production and other hosts are rejected.") from None


def run_backup():
    source = validate_source(os.environ.get("QA_RECOVERY_SOURCE_DATABASE_URL", ""))
    destination = Path(os.environ["QA_RECOVERY_BACKUP_DIR"])
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    public_cert = Path(__file__).resolve().parent.parent / "docs/qa-recovery/backup-recipient-public.pem"
    output = destination / "parkshare-qa-backup.cms"
    os.umask(0o077)
    output.unlink(missing_ok=True)
    base_command = ["npm", "exec", "--yes", f"--package=supabase@{CLI_VERSION}", "--", "supabase", "db", "dump", "--db-url", source]
    try:
        with tempfile.TemporaryDirectory(prefix="qa-source-export-", dir=destination) as temporary:
            raw = Path(temporary)
            for filename, flags in (
                ("roles.sql", ["--role-only"]),
                ("schema.sql", []),
                ("data.sql", ["--data-only", "--use-copy", "-x", "storage.buckets_vectors", "-x", "storage.vector_indexes"]),
            ):
                subprocess.run(base_command + flags + ["--file", str(raw / filename)], check=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900)
                if not (raw / filename).stat().st_size:
                    raise RuntimeError("Empty export")
            manifest = {
                "source_project": SOURCE_REF,
                "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "cli_version": CLI_VERSION,
                "export_type": "Supabase CLI logical export; restore not yet verified",
                "storage_file_bytes_included": False,
                "project_auth_email_settings_included": False,
                "files": {name: {"bytes": (raw / name).stat().st_size,
                                  "sha256": hashlib.sha256((raw / name).read_bytes()).hexdigest()}
                          for name in ("roles.sql", "schema.sql", "data.sql")},
            }
            (raw / "manifest.json").write_text(json.dumps(manifest, indent=2))
            archive = raw / "database.tar.gz"
            with tarfile.open(archive, "w:gz") as tar:
                for name in ("roles.sql", "schema.sql", "data.sql", "manifest.json"):
                    tar.add(raw / name, arcname=name)
            subprocess.run(["openssl", "cms", "-encrypt", "-binary", "-aes-256-cbc", "-in", str(archive),
                            "-out", str(output), "-outform", "DER", str(public_cert)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
            if not output.stat().st_size:
                raise RuntimeError("Empty encrypted archive")
        print("QA database export encrypted successfully. Restore verification remains pending.")
    except Exception:
        output.unlink(missing_ok=True)
        raise RuntimeError("QA backup did not complete. No unencrypted export is uploaded; verify the source credential and database connectivity.") from None


if __name__ == "__main__":
    try:
        run_backup()
    except (ValueError, RuntimeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
