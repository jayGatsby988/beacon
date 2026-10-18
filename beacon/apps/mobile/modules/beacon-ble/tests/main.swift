import Foundation

func expectThrow(_ body: () throws -> Void) {
  do { try body(); fatalError("Expected rejection") } catch { }
}
let vector = try BeaconFrame.encode(Data([0x61, 0x62, 0x63]), id: 0x12345678, limit: 20)
precondition(vector == [Data([0xB7, 1, 0x12, 0x34, 0x56, 0x78, 0, 0, 0, 1, 0, 3, 0x61, 0x62, 0x63])])
for size in [1, 8, 9, 170, 171, 1000, 16384] {
  for limit in [20, 182, 244, 512] {
    let source = Data((0..<size).map { UInt8($0 & 255) })
    let frames = try BeaconFrame.encode(source, id: 42, limit: limit)
    let rx = BeaconReassembler(); var result: Data?
    for frame in frames { precondition(frame.count <= limit); result = try rx.accept(frame) }
    precondition(result == source)
  }
}
expectThrow { _ = try BeaconFrame.encode(Data(), id: 0, limit: 20) }
expectThrow { _ = try BeaconFrame.encode(Data(repeating: 0, count: 16385), id: 0, limit: 20) }
expectThrow { _ = try BeaconFrame.encode(Data([1]), id: 0, limit: 12) }
expectThrow { _ = try BeaconReassembler().accept(Data([0])) }
let two = try BeaconFrame.encode(Data(repeating: 7, count: 10), id: 1, limit: 20)
expectThrow { _ = try BeaconReassembler().accept(two[1]) }
let dup = BeaconReassembler(); _ = try dup.accept(two[0]); expectThrow { _ = try dup.accept(two[0]) }
let bounded = BeaconReassembler()
for id in UInt32(1)...UInt32(2) { _ = try bounded.accept(BeaconFrame.encode(Data(repeating: 0, count: 9), id: id, limit: 20)[0]) }
expectThrow { _ = try bounded.accept(BeaconFrame.encode(Data(repeating: 0, count: 9), id: 3, limit: 20)[0]) }
bounded.expire(now: ProcessInfo.processInfo.systemUptime + 91)
_ = try bounded.accept(BeaconFrame.encode(Data(repeating: 0, count: 9), id: 3, limit: 20)[0])
var corrupt = vector[0]; corrupt[1] = 2
expectThrow { _ = try BeaconReassembler().accept(corrupt) }
print("Beacon Swift framing: 28 round-trips, wire vector, size/order/duplicate/version/capacity/timeout checks passed")

// Deadline advances only with the injected monotonic clock, independent of wall time.
var uptime: TimeInterval = 100
let deadline = BeaconReassembler(clock: { uptime })
_ = try deadline.accept(two[0])
uptime = 189.999
deadline.expire()
let completedBeforeDeadline = try deadline.accept(two[1])
precondition(completedBeforeDeadline == Data(repeating: 7, count: 10))
_ = try deadline.accept(two[0])
uptime = 279.999
expectThrow { _ = try deadline.accept(two[1]) }
print("Beacon Swift monotonic expiration boundary checks passed")

let recovery = BeaconReassembler(); _ = try recovery.accept(two[0])
var mismatched = two[1]; mismatched[11] = 11
expectThrow { _ = try recovery.accept(mismatched) }
_ = try recovery.accept(two[0])
let recovered = try recovery.accept(two[1])
precondition(recovered == Data(repeating: 7, count: 10))
print("Beacon Swift malformed continuation recovery passed")
