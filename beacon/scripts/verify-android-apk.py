#!/usr/bin/env python3
"""Verify the APK signature, Beacon native class, offline JS bundle, and ABI."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--build-tools", type=Path, help="Android SDK build-tools directory containing apksigner and aapt2")
    parser.add_argument("--output", type=Path, help="Save machine-readable verification")
    args = parser.parse_args()
    apk = args.apk.resolve(strict=True)
    sdk = Path(os.environ.get("ANDROID_HOME", ROOT / ".tooling/android-sdk"))
    build_tools = args.build_tools or sdk / "build-tools/36.0.0"
    for tool in ("apksigner", "aapt2"):
        if not (build_tools / tool).is_file():
            raise ValueError(f"Missing {tool}; supply --build-tools or ANDROID_HOME.")
    signature = subprocess.run([str(build_tools / "apksigner"), "verify", "--verbose", str(apk)], check=True, capture_output=True, text=True).stdout
    if not re.search(r"Verified using v[234](?:\.\d+)? scheme[^\n]*: true", signature):
        raise ValueError("APK does not have a verified v2-or-newer signature.")
    badging = subprocess.run([str(build_tools / "aapt2"), "dump", "badging", str(apk)], check=True, capture_output=True, text=True).stdout
    configured_package = json.loads((ROOT / "apps/mobile/app.json").read_text())["expo"]["android"]["package"]
    if f"package: name='{configured_package}'" not in badging:
        raise ValueError(f"APK package differs from configured {configured_package}.")
    with zipfile.ZipFile(apk) as archive:
        corrupt = archive.testzip()
        if corrupt:
            raise ValueError(f"Corrupt ZIP entry: {corrupt}")
        bundle = archive.getinfo("assets/index.android.bundle")
        if bundle.file_size < 1024:
            raise ValueError("Embedded JavaScript bundle is empty or unexpectedly small.")
        dex = [name for name in archive.namelist() if re.fullmatch(r"classes\d*\.dex", name)]
        if not any(b"Lexpo/modules/beaconble/BeaconBleModule;" in archive.read(name) for name in dex):
            raise ValueError("BeaconBleModule was not found in APK DEX classes.")
        libraries = [name for name in archive.namelist() if name.startswith("lib/") and name.endswith(".so")]
        abis = sorted({name.split("/")[1] for name in libraries})
        if abis != ["arm64-v8a"]:
            raise ValueError(f"Expected ARM64-only artifact, found {abis}.")
    digest = hashlib.sha256()
    with apk.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    result = {"apk": str(apk), "package": configured_package, "bytes": apk.stat().st_size,
              "sha256": digest.hexdigest(), "embedded_bundle_bytes": bundle.file_size,
              "native_beacon_class_present": True, "abis": abis,
              "signature_verified": True, "physical_device_tested": False}
    output = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    print(output, end="")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
