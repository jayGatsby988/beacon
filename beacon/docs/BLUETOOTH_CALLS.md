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
blocks and six playback frames are queued. Unsent audio older than 150 ms is
dropped; a partially written record stalled for 500 ms closes the call instead
of accumulating latency. Frame sizes, parser memory, and write queues are
bounded. Muting suppresses new and queued unsent microphone packets; bytes
already handed to the Bluetooth stream cannot be recalled.

Only one native call is allowed. Backgrounding, audio interruptions, loss of an
audio device, Bluetooth disconnect, stream failure, and timeouts stop capture,
playback, streams, timers, and observers. Pending prepare/start promises reject
when the call ends. Stop is scoped to the call ID, so stale cleanup cannot end a
new call. Native audio and ciphertext are held in memory and are not recorded to
disk. Diagnostic call events contain state/reason codes and frame counts.

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

These checks passed on 2026-10-18. They establish codec and cryptographic behavior;
they do not establish physical L2CAP throughput, speech intelligibility, echo
cancellation quality, microphone permissions, or background/foreground behavior
on a phone. A successful native build likewise is not proof of a completed call.
Physical acceptance requires both phones: accept and speak in both directions,
check mute and speaker routing, end from either side, repeat a call, interrupt
and background a call, disconnect Bluetooth, and confirm SOS still works while
audio is active. Report measured hardware results separately.
