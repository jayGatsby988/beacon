import Foundation

enum BeaconVoicePCMError: Error { case invalidBlock }

// Capture and playback callbacks can outlive an engine stop/reconfiguration.
// A short locked generation check prevents old speech and flushed playback
// completions from being treated as belonging to the replacement audio graph.
final class BeaconVoiceAudioEpoch {
  private let lock = NSLock()
  private var generation: UInt64 = 0
  private var active = false

  func begin() -> UInt64 {
    lock.lock(); defer { lock.unlock() }
    generation &+= 1; active = true; return generation
  }

  func end() { lock.lock(); active = false; lock.unlock() }

  func current() -> UInt64? {
    lock.lock(); defer { lock.unlock() }
    return active ? generation : nil
  }

  func contains(_ expected: UInt64) -> Bool {
    lock.lock(); defer { lock.unlock() }
    return active && generation == expected
  }
}

// A callback may be discarded during engine teardown without ever running.
// Keep its semaphore alive and return its slot exactly once on that path too;
// libdispatch traps if a semaphore is destroyed with outstanding acquisitions.
final class BeaconVoiceAudioPermit {
  private let semaphore: DispatchSemaphore
  private let lock = NSLock()
  private var released = false

  init?(_ semaphore: DispatchSemaphore) {
    guard semaphore.wait(timeout: .now()) == .success else { return nil }
    self.semaphore = semaphore
  }

  func release() {
    lock.lock()
    guard !released else { lock.unlock(); return }
    released = true; lock.unlock()
    semaphore.signal()
  }

  deinit { release() }
}

// AVAudioEngine may ignore the requested tap size. Bound by audio duration,
// then split every supported hardware block into fixed 20 ms codec frames.
struct BeaconVoicePCM {
  // iOS100ms tap blocks arrive as5 Opus packets. Two adjacent radio bursts
  // must fit without dropping speech; cap playback at240ms rather than grow.
  static let playbackFrameLimit = 12
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
