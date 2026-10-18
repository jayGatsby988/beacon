#!/usr/bin/env python3
"""Check Beacon's real native voice codec and cryptography locally on macOS."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
native = root / 'apps/mobile/modules/beacon-ble/ios'
opus = native / 'vendor/opus'
if not shutil.which('xcrun'):
    raise SystemExit('Xcode command-line tools on macOS are required.')

includes = []
for folder in ['', 'include', 'src', 'celt', 'silk', 'silk/float']:
    includes.extend(['-I', str(opus / folder)])
sources = sorted(str(path) for path in opus.rglob('*.c'))
sdk = subprocess.check_output(['xcrun', '--sdk', 'iphoneos', '--show-sdk-path'], text=True).strip()
subprocess.run(['xcrun', 'clang', '-O2', '-fsyntax-only', '-Werror=implicit-function-declaration',
                '-target', 'arm64-apple-ios15.1', '-isysroot', sdk, '-DHAVE_CONFIG_H=1',
                *includes, *sources], check=True)
subprocess.run(['xcrun', 'clang', '-fsyntax-only', '-fobjc-arc', '-target', 'arm64-apple-ios15.1',
                '-isysroot', sdk, '-I', str(opus / 'include'), str(native / 'BeaconOpusCodec.m')], check=True)
with tempfile.TemporaryDirectory(prefix='beacon-voice-check-') as temporary:
    area = Path(temporary)
    codec_test = area / 'opus-test'
    subprocess.run(['xcrun', 'clang', '-O2', '-DHAVE_CONFIG_H=1', *includes, *sources,
                    str(native / 'tests/BeaconOpusTest.c'), '-o', str(codec_test)], check=True)
    subprocess.run([str(codec_test)], check=True)
    crypto_test = area / 'crypto-test'
    subprocess.run(['xcrun', 'swiftc', str(native / 'BeaconVoiceCrypto.swift'),
                    str(native / 'tests/BeaconVoiceCryptoTests.swift'), '-o', str(crypto_test)], check=True)
    subprocess.run([str(crypto_test)], check=True)
print('Native voice checks passed; temporary executables removed. Radio/audio hardware checks remain separate.')
