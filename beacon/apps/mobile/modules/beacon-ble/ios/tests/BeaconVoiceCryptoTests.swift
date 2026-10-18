import Foundation

@main
struct BeaconVoiceCryptoTests {
  static func rejects(_ label: String, _ action: () throws -> Void) {
    do { try action(); fatalError("Expected rejection: \(label)") } catch { }
  }
  static func main() throws {
    let callId = String(repeating: "a", count: 64)
    let key = Data(repeating: 7, count: 32)
    let a = try BeaconVoiceCrypto(callId: callId, key: key, initiator: true)
    let b = try BeaconVoiceCrypto(callId: callId, key: key, initiator: false)
    try a.acceptHello(b.hello()); try b.acceptHello(a.hello())
    let proof = try a.seal(Data([1]))
    let proofValue = try b.open(proof)
    precondition(proofValue == Data([1]))
    rejects("replay") { _ = try b.open(proof) }
    let reply = try b.seal(Data([2, 10, 20]))
    let replyValue = try a.open(reply)
    precondition(replyValue == Data([2, 10, 20]))
    let discarded = try a.seal(Data([2, 0]))
    let afterGap = try a.seal(Data([2, 1]))
    let gapValue = try b.open(afterGap)
    precondition(gapValue == Data([2, 1]))
    rejects("late dropped audio") { _ = try b.open(discarded) }
    var tampered = try b.seal(Data([2, 22])); tampered[tampered.count - 1] ^= 1
    rejects("tamper") { _ = try a.open(tampered) }
    let other = try BeaconVoiceCrypto(callId: callId, key: Data(repeating: 8, count: 32), initiator: false)
    rejects("wrong secret") { try other.acceptHello(a.hello()) }
    let wrongCall = try BeaconVoiceCrypto(callId: String(repeating: "b", count: 64), key: key, initiator: false)
    rejects("wrong call") { try wrongCall.acceptHello(a.hello()) }
    let sameRole = try BeaconVoiceCrypto(callId: callId, key: key, initiator: true)
    rejects("reflection") { try sameRole.acceptHello(a.hello()) }
    let retry = try BeaconVoiceCrypto(callId: callId, key: key, initiator: false)
    try retry.acceptHello(a.hello())
    rejects("old connection proof") { _ = try retry.open(proof) }
    rejects("invalid key") { _ = try BeaconVoiceCrypto(callId: callId, key: Data(), initiator: true) }
    rejects("invalid id") { _ = try BeaconVoiceCrypto(callId: "bad", key: key, initiator: true) }
    print("Voice crypto: duplex, replay, tamper, ordering, key/call/role isolation, fresh retry and input checks passed")
  }
}
