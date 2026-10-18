import Foundation

enum BeaconVoicePCMError: Error { case invalidBlock }

// AVAudioEngine may ignore the requested tap size. Bound by audio duration,
// then split every supported hardware block into fixed 20 ms codec frames.
struct BeaconVoicePCM {
  private var samples: [Float] = []
  var pendingSamples: Int { samples.count }

  static func accepts(frameCount: Int, sampleRate: Double, channels: Int) -> Bool {
    sampleRate.isFinite && (8000...192000).contains(sampleRate) && (1...8).contains(channels)
      && frameCount > 0 && frameCount <= 65536 && Double(frameCount) <= ceil(sampleRate * 0.3)
  }

  static func outputCapacity(frameCount: Int, sampleRate: Double) -> Int {
    Int(ceil(Double(frameCount) * 16000 / sampleRate)) + 64
  }

  mutating func append(_ values: [Float]) throws -> [Data] {
    guard values.count <= 4864, values.allSatisfy({ $0.isFinite }) else { throw BeaconVoicePCMError.invalidBlock }
    samples.append(contentsOf: values)
    var frames: [Data] = []
    let count = samples.count / 320
    samples.withUnsafeBytes { bytes in
      for frame in 0..<count {
        frames.append(Data(bytes[(frame * 1280)..<((frame + 1) * 1280)]))
      }
    }
    samples.removeFirst(count * 320)
    return frames
  }

  mutating func reset() { samples.removeAll(keepingCapacity: true) }
}
