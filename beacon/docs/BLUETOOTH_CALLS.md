# Bluetooth calls

Beacon's iPhone calling implementation uses a direct Bluetooth LE L2CAP channel.
It does not relay live audio through other phones or a hosted calling service.
Both phones must keep Beacon in the foreground, share an authenticated Beacon
connection, and accept the call before microphone capture starts. Simulator and
platforms without this native implementation report calling unsupported.

## Native transport and audio

The existing CoreBluetooth central/peripheral managers publish or open the call
channel; SOS and other durable messages retain their independent GATT queues.
The `initiator` native option identifies the Bluetooth central that opens L2CAP,
not necessarily the person who placed the call. A central prepare returns PSM 0;
a listener prepare returns its published PSM. Authenticated application signaling
exchanges that PSM and a fresh 256-bit call key. Native code binds the channel to
the selected live peer session and rejects unrelated peers and stale callbacks.

Each stream starts with fresh 32-byte random challenges and HMAC-SHA256 proofs
bound to call ID and role. HKDF-SHA256 derives separate directional keys from both
challenges. ChaCha20-Poly1305 then authenticates each record, including its
sequence number and call context. Sequence replay/reordering is rejected;
forward gaps allow intentionally dropped unsent audio. Reusing a call ID/key
for a retry does not reuse the connection keys or nonces. The microphone can
start only after the encrypted readiness proof and explicit `voiceStart`.

AVAudioEngine voice processing provides the platform's echo cancellation. Opus
encodes 16 kHz mono speech in 20 ms frames at 12 kbit/s. At most three capture
blocks and six playback frames are queued. The requested input tap size is only
a preference: supported hardware blocks may contain up to 300 ms of audio.
`BeaconVoicePCM` validates duration against the actual sample rate (8–192 kHz,
1–8 channels, with an additional 65,536-frame safety ceiling). It splits converted
16 kHz PCM into every complete 320-sample codec frame and retains fewer than 320
samples for the next block. A valid large hardware block is not discarded just
because its frame count exceeds 4,096 or its converted sample count exceeds
3,200. Unsupported blocks fail explicitly rather than producing silent capture.
Unsent audio older than 150 ms is
dropped; a partially written record stalled for 500 ms closes the call instead
of accumulating latency. Frame sizes, parser memory, and write queues are
bounded. Muting suppresses new and queued unsent microphone packets; bytes
already handed to the Bluetooth stream cannot be recalled.

The 12 kbit/s codec payload is not the total radio budget. A usual 30-byte Opus
packet becomes a 58-byte framed encrypted record: 1-byte audio kind, 1-byte
record kind, 8-byte sequence, 16-byte authentication tag, and 2-byte length.
At 50 frames/second this is about 2.9 kB/s per direction, or 46.4 kbit/s duplex,
before L2CAP/Bluetooth overhead and control records. Silence suppression can
reduce the payload traffic.

Only one native call is allowed. Backgrounding, audio interruptions, loss of an
audio device, Bluetooth disconnect, stream failure, and timeouts stop capture,
playback, streams, timers, and observers. Pending prepare/start promises reject
when the call ends. Stop is scoped to the call ID, so stale cleanup cannot end a
new call. Native audio and ciphertext are held in memory and are not recorded to
disk. Diagnostic call events contain state/reason codes and frame counts.

Operational diagnostics write asynchronously to stdout and a bounded cache: connection/authentication
stages, hardware tap size/sample rate/channel count, generic route type, native
error domain/code, and a bounded counter summary every two seconds while ready.
The summary distinguishes captured, converted, encoded, transmitted, received,
decoded, and played frames, nonzero-buffer counts, and dropped blocks. Engine
running/player playing state and configuration, route, interruption, and media
service reset events help identify an engine that stopped after startup. Logs
do not contain audio samples, call or peer identities, keys, location, or message
content. No diagnostic changes restart or otherwise change audio behavior.

The app retains UTC-timestamped metadata across relaunch in
`Library/Caches/beacon-voice-diagnostics.log` and
`Library/Caches/beacon-voice-diagnostics.previous.log`. Each file is at most
64 KiB, totaling at most 128 KiB. Files expire 24 hours after their oldest entry,
checked on the next log write; iOS may evict cache files earlier. A serial utility
queue performs all console/file I/O, with at most 32 pending entries and a
4 KiB per-entry bound; excess diagnostics are discarded rather than delaying
audio. The native checker exercises the actual store's rotation, relaunch
retention, expiry, line sanitation, and corrupt-cache recovery. To inspect a
physical test later, copy only these two files from the app data container using
Xcode Devices or `devicectl device copy from --domain-type appDataContainer`
with the app bundle identifier and the relative paths above. No microphone or
Bluetooth access is needed to run the host diagnostics test.

CoreBluetooth does not expose cancellation of an individual pending channel-open
operation or an unpublished listener whose PSM has not yet returned. If its
callback never arrives, the ended call retains an operation marker so a delayed
callback cannot attach to a new call. Another call reports that Bluetooth is
still closing the last call; restarting Nearby retires the managers and clears
the marker. This recovery preserves callback safety without automatically
interrupting the independent GATT transport.

## Codec provenance

The pod compiles the portable C implementation from the official
[libopus 1.6.1 release](https://opus-codec.org/downloads/), with its upstream
license retained under `apps/mobile/modules/beacon-ble/ios/vendor/opus/COPYING`.
The archive URL, pinned SHA-256, source selection, and portable build settings
are recorded in that directory's `BEACON_VENDOR.md`. No third-party binary codec
or runtime download is required.

## Verification and limits

Run `python3 scripts/check-native-voice.py` on macOS with Xcode installed. It
checks all portable codec C sources and the Objective-C wrapper against the iOS
SDK, compiles the real codec on the host, and runs 100 encoded/decoded speech-rate
frames. It also compiles and executes the actual CryptoKit implementation with
duplex traffic, tampering, replay, out-of-order packets, wrong secret/call/role,
fresh retry, and invalid-input cases. Temporary executables are removed.

The retained `BeaconVoicePCMTests.swift` regression additionally runs the real
AVAudioConverter with the production PCM sizing/framing helper across 22
accepted format/block-size cases. It verifies nonzero synthetic output and exact
sample conservation, including 4,800 frames at 48 kHz and 4,096 frames at 16 kHz,
plus invalid duration/rate/channel and converted-block bounds. It does not open
the microphone or use recorded speech.

The production-wrapper regression links the actual `BeaconOpusCodec.m` with its
VOIP/VOICE/DTX settings and `BeaconVoicePCM`. It passes 350 synthetic
speech/silence/speech frames with exact framing, 94 late-silence DTX packets,
and recovered speech RMS of 0.0604 before and 0.0635 after silence. This closes
the prior gap between the standalone C codec test and the production wrapper;
it still does not open the microphone, Bluetooth stream, or speaker.

These checks passed on 2026-10-18. They establish codec and cryptographic behavior;
they do not establish physical L2CAP throughput, speech intelligibility, echo
cancellation quality, microphone permissions, or background/foreground behavior
on a phone. A successful native build likewise is not proof of a completed call.
Physical acceptance requires both phones: accept and speak in both directions,
check mute and speaker routing, end from either side, repeat a call, interrupt
and background a call, disconnect Bluetooth, and confirm SOS still works while
audio is active. Report measured hardware results separately.

### Physical audio investigation — 2026-10-18

The first two-phone call reached a running timer on both phones, but both were
silent despite microphone permission, speaker output, and increased volume.
This establishes a failed audio acceptance test, not working voice delivery.
The synthetic regression then reproduced two real implementation defects:
the fixed 4,096-frame input cutoff discarded a valid 4,800-frame/48 kHz block,
and the 3,200-sample accumulator cutoff discarded a valid 4,096-frame/16 kHz
block. Both paths were replaced by the duration-aware production helper above;
the complete native check script, including all 22 converter/framing cases,
passed. Actual hardware tap sizes and successful two-way speech still require
the diagnostic rebuild and physical retest. The reproduced defects are not
yet confirmed as the sole cause of the observed silence.

A later paired physical test captured authenticated, ready streams on both
phones, successful audio-engine/player starts at 48 kHz mono, and increasing
keepalive bytes, but zero microphone tap callbacks and zero transmitted or
received audio frames. This isolates that observed failure before conversion,
encoding, or audio transport. Speaker toggles did not start capture.

The next native revision explicitly connects the input to an `AVAudioSinkNode`
whose receiver does no work, retains the input recording tap, and connects the
16 kHz playback player through the mixer to an output using the same 48 kHz mono
I/O client format as input. There is no microphone-to-speaker connection. Apple
documents a recording tap as sufficient in principle, so the earlier missing
explicit connection alone is not established as the cause. The graph change
uses the input sink supported for VoIP and the explicit matching I/O setup in
Apple's [voice-processing sample](https://developer.apple.com/documentation/avfaudio/using-voice-processing)
and [sink documentation](https://developer.apple.com/documentation/avfaudio/avaudiosinknode).
A main-run-loop watchdog ends the call after three seconds without tap progress,
distinguishing a stopped engine from missing capture; mute does not suppress
tap progress. It does not restart audio automatically.

The revised audio source passed an actual arm64 iOS 15.1-targeted Swift typecheck.
Persistent diagnostics regression and the complete native host codec/crypto/PCM
checks passed. Successful speech on the revised graph still requires a paired
physical retest; these checks do not establish that audio now works on hardware.
