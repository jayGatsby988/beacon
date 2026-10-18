#!/usr/bin/env python3
"""Exercise the production Android scan policy without a device or Gradle build."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
module = root / 'apps/mobile/modules/beacon-ble'
sources = [module / 'android/src/main/java/expo/modules/beaconble/BeaconScanPolicy.kt',
           module / 'tests/ScanPolicyTest.kt']
java = str(Path(os.environ['JAVA_HOME']) / 'bin/java') if os.environ.get('JAVA_HOME') else shutil.which('java')
if not java:
    raise SystemExit('Java is required; set JAVA_HOME or add java to PATH.')
with tempfile.TemporaryDirectory(prefix='beacon-discovery-check-') as temporary:
    area = Path(temporary)
    compiler = os.environ.get('KOTLINC') or shutil.which('kotlinc')
    if compiler:
        jar = area / 'discovery.jar'
        subprocess.run([compiler, *map(str, sources), '-include-runtime', '-d', str(jar)], check=True)
        subprocess.run([java, '-jar', str(jar)], check=True)
    else:
        cache = Path(os.environ.get('GRADLE_USER_HOME', root / '.tooling/gradle')) / 'caches/modules-2/files-2.1'
        versions = {'kotlin-compiler-embeddable': '2.1.20', 'kotlin-stdlib': '2.1.20',
                    'kotlin-script-runtime': '2.1.20', 'kotlin-reflect': '1.6.10',
                    'trove4j': '1.0.20200330', 'kotlinx-coroutines-core-jvm': '1.8.0', 'annotations': '13.0'}
        jars = []
        for name, version in versions.items():
            matches = sorted(cache.glob(f'*/{name}/{version}/*/{name}-{version}.jar'))
            if not matches:
                raise SystemExit(f'Missing cached {name} {version}; set KOTLINC or run the documented Android build first.')
            jars.append(str(matches[0]))
        classpath = os.pathsep.join(jars)
        classes = area / 'classes'
        subprocess.run([java, '-cp', classpath, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
                        '-no-stdlib', '-no-reflect', '-classpath', classpath, *map(str, sources),
                        '-d', str(classes)], check=True)
        subprocess.run([java, '-cp', str(classes) + os.pathsep + classpath,
                        'expo.modules.beaconble.ScanPolicyTestKt'], check=True)
