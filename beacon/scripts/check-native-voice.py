#!/usr/bin/env python3
"""Check Beacon's real native voice codec and cryptography locally on macOS."""
from pathlib import Path
import argparse
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host-only', action='store_true',
                    help='Run real macOS codec/crypto/queue tests, explicitly skipping iOS SDK compilation.')
args = parser.parse_args()
native = root / 'apps/mobile/modules/beacon-ble/ios'
opus = native / 'vendor/opus'
if not shutil.which('xcrun'):
    raise SystemExit('Xcode command-line tools on macOS are required.')

includes = []
for folder in ['', 'include', 'src', 'celt', 'silk', 'silk/float']:
    includes.extend(['-I', str(opus / folder)])
sources = sorted(str(path) for path in opus.rglob('*.c'))
if args.host_only:
    print('HOST ONLY: skipping iOS SDK compilation; this does not validate an iPhone build.', flush=True)
else:
    sdk = subprocess.check_output(['xcrun', '--sdk', 'iphoneos', '--show-sdk-path'], text=True).strip()
    subprocess.run(['xcrun', 'clang', '-O2', '-fsyntax-only', '-Werror=implicit-function-declaration',
                    '-target', 'arm64-apple-ios15.1', '-isysroot', sdk, '-DHAVE_CONFIG_H=1',
                    *includes, *sources], check=True)
    subprocess.run(['xcrun', 'clang', '-fsyntax-only', '-fobjc-arc', '-target', 'arm64-apple-ios15.1',
                    '-isysroot', sdk, '-I', str(opus / 'include'), str(native / 'BeaconOpusCodec.m')], check=True)
with tempfile.TemporaryDirectory(prefix='beacon-voice-check-') as temporary:
    area = Path(temporary)
    # Compile the exact Foundation-only production store, excluding the iOS
    # audio/session portion that cannot run in a host command-line process.
    audio_source = (native / 'BeaconVoiceAudio.swift').read_text()
    marker = 'private final class BeaconVoiceDiagnostics'
    assert audio_source.count(marker) == 1
    diagnostics_source = area / 'BeaconVoiceTraceStore.swift'
    diagnostics_source.write_text(audio_source.split(marker)[0])
    diagnostics_test = area / 'diagnostics-test'
    subprocess.run(['xcrun', 'swiftc', str(diagnostics_source),
                    str(native / 'tests/BeaconVoiceDiagnosticsTests.swift'), '-o', str(diagnostics_test)], check=True)
    subprocess.run([str(diagnostics_test), str(area / 'diagnostic-cache')], check=True)
    codec_test = area / 'opus-test'
    subprocess.run(['xcrun', 'clang', '-O2', '-DHAVE_CONFIG_H=1', *includes, *sources,
                    str(native / 'tests/BeaconOpusTest.c'), '-o', str(codec_test)], check=True)
    subprocess.run([str(codec_test)], check=True)
    crypto_test = area / 'crypto-test'
    subprocess.run(['xcrun', 'swiftc', str(native / 'BeaconVoiceCrypto.swift'),
                    str(native / 'tests/BeaconVoiceCryptoTests.swift'), '-o', str(crypto_test)], check=True)
    subprocess.run([str(crypto_test)], check=True)
    write_test = area / 'write-test'
    subprocess.run(['xcrun', 'swiftc', str(native / 'BeaconVoiceWrite.swift'),
                    str(native / 'tests/BeaconVoiceWriteTests.swift'), '-o', str(write_test)], check=True)
    subprocess.run([str(write_test)], check=True)
    pcm_test = area / 'pcm-test'
    subprocess.run(['xcrun', 'swiftc', str(native / 'BeaconVoicePCM.swift'),
                    str(native / 'tests/BeaconVoicePCMTests.swift'), '-o', str(pcm_test)], check=True)
    subprocess.run([str(pcm_test)], check=True)
    # Link the real ObjC wrapper, not a second copy of its codec configuration.
    wrapper_library = area / 'libBeaconVoiceCodec.dylib'
    subprocess.run(['xcrun', 'clang', '-O2', '-dynamiclib', '-fobjc-arc',
                    '-DHAVE_CONFIG_H=1', *includes, *sources,
                    str(native / 'BeaconOpusCodec.m'), '-framework', 'Foundation',
                    '-o', str(wrapper_library)], check=True)
    pipeline_test = area / 'codec-pipeline-test'
    subprocess.run(['xcrun', 'swiftc', '-import-objc-header', str(native / 'BeaconOpusCodec.h'),
                    str(native / 'BeaconVoicePCM.swift'),
                    str(native / 'tests/BeaconVoiceCodecPipelineTests.swift'),
                    '-L', str(area), '-lBeaconVoiceCodec', '-Xlinker', '-rpath', '-Xlinker', str(area),
                    '-o', str(pipeline_test)], check=True)
    subprocess.run([str(pipeline_test)], check=True)
print('Native voice checks passed; temporary executables removed. Radio/audio hardware checks remain separate.')
