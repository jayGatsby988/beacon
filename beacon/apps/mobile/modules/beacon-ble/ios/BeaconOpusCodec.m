#import "BeaconOpusCodec.h"
#include "opus.h"

@implementation BeaconOpusCodec {
  OpusEncoder *_encoder;
  OpusDecoder *_decoder;
}
- (nullable instancetype)init {
  self = [super init];
  if (!self) return nil;
  int error = OPUS_OK;
  _encoder = opus_encoder_create(16000, 1, OPUS_APPLICATION_VOIP, &error);
  if (!_encoder || error != OPUS_OK) return nil;
  _decoder = opus_decoder_create(16000, 1, &error);
  if (!_decoder || error != OPUS_OK) return nil;
  if (opus_encoder_ctl(_encoder, OPUS_SET_BITRATE(12000)) != OPUS_OK ||
      opus_encoder_ctl(_encoder, OPUS_SET_VBR(0)) != OPUS_OK ||
      opus_encoder_ctl(_encoder, OPUS_SET_COMPLEXITY(5)) != OPUS_OK ||
      opus_encoder_ctl(_encoder, OPUS_SET_SIGNAL(OPUS_SIGNAL_VOICE)) != OPUS_OK ||
      opus_encoder_ctl(_encoder, OPUS_SET_DTX(1)) != OPUS_OK) return nil;
  return self;
}
- (nullable NSData *)encodeSamples:(NSData *)samples {
  if (samples.length != 320 * sizeof(float)) return nil;
  unsigned char packet[256];
  int count = opus_encode_float(_encoder, samples.bytes, 320, packet, sizeof(packet));
  return count > 0 ? [NSData dataWithBytes:packet length:(NSUInteger)count] : nil;
}
- (nullable NSData *)decodePacket:(NSData *)packet {
  if (packet.length == 0 || packet.length > 256) return nil;
  float samples[320];
  int count = opus_decode_float(_decoder, packet.bytes, (opus_int32)packet.length, samples, 320, 0);
  return count == 320 ? [NSData dataWithBytes:samples length:sizeof(samples)] : nil;
}
- (void)dealloc {
  if (_encoder) opus_encoder_destroy(_encoder);
  if (_decoder) opus_decoder_destroy(_decoder);
}
@end
