import Foundation

// Stream.write may accept only part of an encrypted record. Once any byte has
// left the queue, keep the rest in order and time out only when progress stops.
final class BeaconVoiceWrite {
  let data: Data
  let audio: Bool
  let created: TimeInterval
  private(set) var offset = 0
  private(set) var lastProgress: TimeInterval

  init(_ data: Data, audio: Bool, now: TimeInterval = ProcessInfo.processInfo.systemUptime) {
    self.data = Data([UInt8(data.count >> 8), UInt8(data.count & 255)]) + data
    self.audio = audio
    self.created = now
    self.lastProgress = now
  }

  func didWrite(_ count: Int, now: TimeInterval = ProcessInfo.processInfo.systemUptime) {
    precondition(count > 0 && count <= data.count - offset)
    offset += count
    lastProgress = now
  }

  func isStalled(at now: TimeInterval) -> Bool {
    // Unsent audio is expendable and will be discarded after 150 ms by pump.
    // Control records must leave within two seconds. Partial records cannot be
    // dropped without corrupting the stream; allow the same bounded recovery
    // window instead of ending a call on a brief 500 ms radio pause. Unsent
    // audio still expires at 150 ms, so recovery does not replay a stale backlog.
    if offset == 0 { return !audio && now - created > 2 }
    return offset < data.count && now - lastProgress > 2
  }
}
