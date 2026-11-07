#!/usr/bin/env python3
"""Validate Apple credentials and upload GitHub Actions secrets without printing them."""

import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid


def run(args, error_message=None, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        # Command output can contain credential material; report only the operation.
        raise RuntimeError(error_message or f"{args[0]} {args[1]} failed; check authentication and permissions.")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="Directory containing Certificates.p12, AuthKey_*.p8, and ASC_ISSUER_ID.txt")
    parser.add_argument("--repo", required=True, help="GitHub repository, for example limboy/polyfork")
    parser.add_argument("--check-only", action="store_true", help="Validate local files without contacting Apple or GitHub")
    args = parser.parse_args()

    certificate = args.directory / "Certificates.p12"
    keys = list(args.directory.glob("AuthKey_*.p8"))
    if not certificate.is_file() or len(keys) != 1:
        raise RuntimeError("Expected Certificates.p12 and exactly one AuthKey_*.p8 file.")
    key = keys[0]
    key_id = key.stem.removeprefix("AuthKey_")
    if not re.fullmatch(r"[A-Z0-9]{10,}", key_id):
        raise RuntimeError("The API key filename must be AuthKey_<KEY_ID>.p8.")
    issuer = str(uuid.UUID((args.directory / "ASC_ISSUER_ID.txt").read_text(encoding="utf-8-sig").strip()))
    password = os.environ.get("APPLE_CERTIFICATE_PASSWORD", "")

    # Older PKCS#12 exports require OpenSSL 3's legacy provider.
    certificate_env = dict(os.environ, POLYFORK_P12_PASSWORD=password)
    command = ["openssl", "pkcs12", "-in", str(certificate), "-nokeys", "-clcerts", "-passin", "env:POLYFORK_P12_PASSWORD"]
    result = subprocess.run(command, capture_output=True, env=certificate_env)
    if result.returncode:
        result = subprocess.run(command + ["-legacy"], capture_output=True, env=certificate_env)
    if result.returncode:
        raise RuntimeError("Cannot read the certificate. If it has an export password, set APPLE_CERTIFICATE_PASSWORD before running this helper.")
    info = run(["openssl", "x509", "-noout", "-subject", "-enddate"], input=result.stdout)
    if b"Developer ID Application:" not in info:
        raise RuntimeError("The certificate must be a Developer ID Application certificate.")
    run(["openssl", "x509", "-noout", "-checkend", "0"], input=result.stdout)
    # Parse the key without printing it. Apple's LibreSSL lacks `pkey -check`;
    # Notary API authentication below verifies the key with Apple.
    run(["openssl", "pkey", "-in", str(key), "-passin", "pass:", "-noout"],
        error_message="Cannot parse the API key; expected an unencrypted private key in the .p8 file.")
    expiry = next(line.removeprefix("notAfter=") for line in info.decode().splitlines() if line.startswith("notAfter="))
    print(f"Developer ID Application certificate valid until {expiry}.", flush=True)
    if args.check_only:
        print("Local credential checks passed; nothing was uploaded.")
        return

    existing = json.loads(run(["gh", "secret", "list", "--repo", args.repo, "--json", "name"]))
    print("Validating Notary API access with Apple...", flush=True)
    run(["xcrun", "notarytool", "history", "--key", str(key), "--key-id", key_id, "--issuer", issuer, "--output-format", "json"], timeout=60)

    secrets = {
        "APPLE_CERTIFICATE_P12_BASE64": base64.b64encode(certificate.read_bytes()),
        "ASC_PRIVATE_KEY_BASE64": base64.b64encode(key.read_bytes()),
        "ASC_KEY_ID": key_id.encode(),
        "ASC_ISSUER_ID": issuer.encode(),
    }
    if password:
        secrets["APPLE_CERTIFICATE_PASSWORD"] = password.encode()
    elif any(item["name"] == "APPLE_CERTIFICATE_PASSWORD" for item in existing):
        run(["gh", "secret", "delete", "APPLE_CERTIFICATE_PASSWORD", "--repo", args.repo])
    for name, value in secrets.items():
        run(["gh", "secret", "set", name, "--repo", args.repo], input=value)
        print(f"Configured {name} in {args.repo}.", flush=True)
    print("Setup complete. Push the workflow, then run Build macOS DMG from GitHub Actions.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError, StopIteration, subprocess.TimeoutExpired) as error:
        # Avoid tracebacks and command output, which may include secret values.
        print(f"Setup failed: {error}", file=sys.stderr)
        sys.exit(1)
