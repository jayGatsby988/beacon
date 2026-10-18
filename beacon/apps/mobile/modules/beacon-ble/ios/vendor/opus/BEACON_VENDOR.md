# libopus 1.6.1

Official source: https://downloads.xiph.org/releases/opus/opus-1.6.1.tar.gz

Archive SHA-256: `6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1`.

Unmodified portable C sources selected from upstream `OPUS_SOURCES`,
`OPUS_SOURCES_FLOAT`, `CELT_SOURCES`, `SILK_SOURCES`, and `SILK_SOURCES_FLOAT`.
Headers are from include, src, celt, silk, and silk/float. The upstream license
is retained in COPYING. config.h is Beacon's portable configuration; SIMD,
assembly, runtime architecture detection, and optional neural models are off.
The pod compiles this source directly for the selected iOS architecture.

Voice uses 16 kHz mono, 20 ms frames, constrained 12 kbit/s speech encoding.
No microphone audio or call ciphertext is persisted by the native implementation.
