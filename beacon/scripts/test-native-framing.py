#!/usr/bin/env python3
"""Run the real native framing fixtures without building a phone application."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "apps/mobile/modules/beacon-ble"


def run(command):
    subprocess.run([str(item) for item in command], cwd=ROOT, check=True)


def kotlin(directory):
    explicit = os.environ.get("KOTLINC") or shutil.which("kotlinc")
    java = Path(os.environ["JAVA_HOME"]) / "bin/java" if os.environ.get("JAVA_HOME") else shutil.which("java")
    if not java:
        raise RuntimeError("Java is required; set JAVA_HOME or add java to PATH.")
    sources = [MODULE / "android/src/main/java/expo/modules/beaconble/BeaconFrame.kt", MODULE / "tests/FrameTest.kt"]
    if explicit:
        jar = directory / "framing.jar"
        run([explicit, *sources, "-include-runtime", "-d", jar])
        run([java, "-jar", jar])
        return
    # Reuse the exact compiler/dependencies downloaded by the verified Expo build.
    cache = Path(os.environ.get("GRADLE_USER_HOME", ROOT / ".tooling/gradle")) / "caches/modules-2/files-2.1"
    dependencies = {
        "kotlin-compiler-embeddable": "2.1.20",
        "kotlin-stdlib": "2.1.20",
        "kotlin-script-runtime": "2.1.20",
        "kotlin-reflect": "1.6.10",
        "trove4j": "1.0.20200330",
        "kotlinx-coroutines-core-jvm": "1.8.0",
        "annotations": "13.0",
    }
    jars = []
    for name, version in dependencies.items():
        matches = sorted(cache.glob(f"*/{name}/{version}/*/{name}-{version}.jar"))
        if not matches:
            raise RuntimeError(f"Missing cached {name} {version}; install Kotlin 2.1.20 and set KOTLINC, or run the documented Android build first.")
        jars.append(matches[0])
    classpath = os.pathsep.join(map(str, jars))
    classes = directory / "classes"
    run([java, "-cp", classpath, "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-no-stdlib", "-no-reflect", "-classpath", classpath, *sources, "-d", classes])
    run([java, "-cp", str(classes) + os.pathsep + classpath, "expo.modules.beaconble.FrameTestKt"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=["swift", "kotlin", "all"], default="all")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="beacon-framing-") as temporary:
        directory = Path(temporary)
        if args.language in ("swift", "all"):
            if not shutil.which("xcrun"):
                raise RuntimeError("Swift check requires macOS and Xcode command-line tools; use --language kotlin elsewhere.")
            binary = directory / "framing"
            run(["xcrun", "swiftc", MODULE / "ios/BeaconFrame.swift", MODULE / "tests/main.swift", "-o", binary])
            run([binary])
        if args.language in ("kotlin", "all"):
            kotlin(directory)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
