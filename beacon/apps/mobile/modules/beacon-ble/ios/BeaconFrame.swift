import Foundation

enum BeaconFrameError: Error { case invalid, capacity }
struct BeaconFrame {
  static let maxBytes = 16_384
  static let header = 12
  static func encode(_ data: Data, id: UInt32, limit: Int) throws -> [Data] {
    guard !data.isEmpty, data.count <= maxBytes, limit > header else { throw BeaconFrameError.invalid }
    let size = min(limit, 512) - header
    let count = (data.count + size - 1) / size
    return (0..<count).map { index in
      var frame = Data([0xB7, 1, UInt8((id >> 24) & 255), UInt8((id >> 16) & 255), UInt8((id >> 8) & 255), UInt8(id & 255), UInt8(index >> 8), UInt8(index & 255), UInt8(count >> 8), UInt8(count & 255), UInt8(data.count >> 8), UInt8(data.count & 255)])
      frame.append(data.subdata(in: index * size..<min((index + 1) * size, data.count)))
      return frame
    }
  }
}
final class BeaconReassembler {
  struct Partial { let count: Int; let total: Int; let created: TimeInterval; var next: Int; var data: Data }
  private let clock: () -> TimeInterval
  init(clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) { self.clock = clock }
  private var partials: [UInt32: Partial] = [:]
  func expire(now: TimeInterval? = nil) { let current = now ?? clock(); partials = partials.filter { current - $0.value.created < 90 } }
  func accept(_ frame: Data) throws -> Data? {
    expire()
    let b = [UInt8](frame)
    guard b.count > 12, b.count <= 512, b[0] == 0xB7, b[1] == 1 else { throw BeaconFrameError.invalid }
    let id = (UInt32(b[2]) << 24) | (UInt32(b[3]) << 16) | (UInt32(b[4]) << 8) | UInt32(b[5])
    let index = Int(b[6]) * 256 + Int(b[7]), count = Int(b[8]) * 256 + Int(b[9]), total = Int(b[10]) * 256 + Int(b[11])
    guard total > 0, total <= BeaconFrame.maxBytes, count > 0, count <= total, index < count else { throw BeaconFrameError.invalid }
    if partials[id] == nil {
      guard index == 0 else { throw BeaconFrameError.invalid }
      guard partials.count < 2 else { throw BeaconFrameError.capacity }
      partials[id] = Partial(count: count, total: total, created: clock(), next: 0, data: Data())
    }
    guard var p = partials[id], p.next == index, p.count == count, p.total == total, p.data.count + b.count - 12 <= total else {
      partials.removeValue(forKey: id); throw BeaconFrameError.invalid
    }
    p.data.append(contentsOf: b.dropFirst(12)); p.next += 1
    if p.next == count {
      partials.removeValue(forKey: id)
      guard p.data.count == total else { throw BeaconFrameError.invalid }
      return p.data
    }
    partials[id] = p
    return nil
  }
}
