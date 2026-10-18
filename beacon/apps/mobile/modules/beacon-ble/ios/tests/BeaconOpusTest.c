#include "opus.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
int main(void) {
  int error;
  OpusEncoder *encoder = opus_encoder_create(16000, 1, OPUS_APPLICATION_VOIP, &error);
  assert(encoder && error == OPUS_OK);
  OpusDecoder *decoder = opus_decoder_create(16000, 1, &error);
  assert(decoder && error == OPUS_OK);
  assert(opus_encoder_ctl(encoder, OPUS_SET_BITRATE(12000)) == OPUS_OK);
  assert(opus_encoder_ctl(encoder, OPUS_SET_VBR(0)) == OPUS_OK);
  assert(opus_encoder_ctl(encoder, OPUS_SET_COMPLEXITY(5)) == OPUS_OK);
  double energy = 0;
  for (int frame = 0; frame < 100; frame++) {
    float input[320], output[320]; unsigned char packet[256];
    for (int i = 0; i < 320; i++) input[i] = 0.3f * sinf((frame * 320 + i) * 0.1727876f);
    int bytes = opus_encode_float(encoder, input, 320, packet, sizeof(packet));
    assert(bytes > 0 && bytes <= 40);
    assert(opus_decode_float(decoder, packet, bytes, output, 320, 0) == 320);
    for (int i = 0; i < 320; i++) { assert(isfinite(output[i])); energy += output[i] * output[i]; }
  }
  assert(energy > 100);
  opus_encoder_destroy(encoder); opus_decoder_destroy(decoder);
  puts("Portable Opus: 100 speech-rate 20ms encode/decode frames passed");
  return 0;
}
