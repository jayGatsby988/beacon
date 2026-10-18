#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
/** Single-queue codec, 320 Float32 samples per 20 ms frame at 16 kHz mono. */
@interface BeaconOpusCodec : NSObject
- (nullable instancetype)init;
- (nullable NSData *)encodeSamples:(NSData *)samples;
- (nullable NSData *)decodePacket:(NSData *)packet;
@end
NS_ASSUME_NONNULL_END
