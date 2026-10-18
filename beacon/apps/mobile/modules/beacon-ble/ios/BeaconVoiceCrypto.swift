import Foundation
import CryptoKit
import Security

enum BeaconVoiceError: Error {
  case invalid, authentication, replay, unavailable
}

// Per-connection random challenges prevent nonce/key reuse, even if JS retries
// the same call ID and secret. Every live record is authenticated and ordered.
final class BeaconVoiceCrypto {
  private let master: SymmetricKey
  private let context: Data
  private let initiator: Bool
  private let challenge: Data
  private var sendKey: SymmetricKey?
  private var receiveKey: SymmetricKey?
  private var tx: UInt64 = 0
  private var rx: UInt64?

  init(callId: String, key: Data, initiator: Bool) throws {
    guard key.count == 32, callId.count == 64,
      callId.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { throw BeaconVoiceError.invalid }
    self.master = SymmetricKey(data: key)
    self.context = Data(("beacon-voice-v1:" + callId.lowercased()).utf8)
    self.initiator = initiator
    var random = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else { throw BeaconVoiceError.unavailable }
    self.challenge = Data(random)
  }

  func hello() -> Data {
    let body = Data([initiator ? 1 : 0]) + challenge
    return Data([0]) + body + Data(HMAC<SHA256>.authenticationCode(for: context + body, using: master))
  }

  func acceptHello(_ data: Data) throws {
    guard sendKey == nil, data.count == 66, data[0] == 0, data[1] == (initiator ? 0 : 1) else { throw BeaconVoiceError.invalid }
    let body = data.subdata(in: 1..<34)
    guard HMAC<SHA256>.isValidAuthenticationCode(data.suffix(32), authenticating: context + body, using: master) else { throw BeaconVoiceError.authentication }
    let remote = data.subdata(in: 2..<34)
    let salt = initiator ? challenge + remote : remote + challenge
    let opener = HKDF<SHA256>.deriveKey(inputKeyMaterial: master, salt: salt, info: context + Data("opener".utf8), outputByteCount: 32)
    let listener = HKDF<SHA256>.deriveKey(inputKeyMaterial: master, salt: salt, info: context + Data("listener".utf8), outputByteCount: 32)
    sendKey = initiator ? opener : listener
    receiveKey = initiator ? listener : opener
  }

  func seal(_ plaintext: Data) throws -> Data {
    guard let key = sendKey, tx < UInt64.max, plaintext.count <= 257 else { throw BeaconVoiceError.invalid }
    var counter = tx.bigEndian
    let sequence = withUnsafeBytes(of: &counter) { Data($0) }
    let nonce = try ChaChaPoly.Nonce(data: Data(repeating: 0, count: 4) + sequence)
    let box = try ChaChaPoly.seal(plaintext, using: key, nonce: nonce, authenticating: context + sequence)
    tx += 1
    return Data([1]) + sequence + box.ciphertext + box.tag
  }

  func open(_ record: Data) throws -> Data {
    guard let key = receiveKey, record.count >= 26, record.count <= 282, record[0] == 1 else { throw BeaconVoiceError.invalid }
    let sequence = record.subdata(in: 1..<9)
    let number = sequence.reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    // Gaps are permitted because unsent stale audio is deliberately dropped.
    guard rx == nil || number > rx! else { throw BeaconVoiceError.replay }
    let nonce = try ChaChaPoly.Nonce(data: Data(repeating: 0, count: 4) + sequence)
    let box = try ChaChaPoly.SealedBox(nonce: nonce, ciphertext: record.subdata(in: 9..<(record.count - 16)), tag: record.suffix(16))
    let value = try ChaChaPoly.open(box, using: key, authenticating: context + sequence)
    rx = number
    return value
  }
}
