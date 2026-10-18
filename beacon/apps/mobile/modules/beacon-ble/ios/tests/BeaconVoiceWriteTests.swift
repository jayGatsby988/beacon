import Foundation

@main
struct BeaconVoiceWriteTests {
  static func main() {
    let record = BeaconVoiceWrite(Data(repeating: 9, count: 66), audio: false, now: 10)
    precondition(record.data.prefix(2) == Data([0, 66]))
    precondition(record.data.count == 68)

    // A split write making steady progress must survive longer than 500 ms.
    // Previously the session timed out at 10.6 despite the write at 10.5.
    record.didWrite(10, now: 10.2)
    record.didWrite(10, now: 10.5)
    precondition(!record.isStalled(at: 10.6))
    record.didWrite(10, now: 10.8)
    precondition(!record.isStalled(at: 11.2))
    precondition(!record.isStalled(at: 11.31))
    precondition(record.isStalled(at: 12.81))

    // Completing a record clears the stall condition. A genuinely idle partial
    // audio frame must still fail, because dropping its tail corrupts framing.
    record.didWrite(38, now: 11.4)
    precondition(record.offset == record.data.count)
    precondition(!record.isStalled(at: 20))
    let partialAudio = BeaconVoiceWrite(Data([1, 2, 3]), audio: true, now: 0)
    partialAudio.didWrite(1, now: 0.1)
    precondition(!partialAudio.isStalled(at: 0.59))
    precondition(!partialAudio.isStalled(at: 0.61))
    precondition(!partialAudio.isStalled(at: 1.6))
    partialAudio.didWrite(1, now: 1.6)
    precondition(!partialAudio.isStalled(at: 3.59))
    precondition(partialAudio.isStalled(at: 3.61))
    // Keep the exact remaining bytes of a partly sent encrypted frame. A
    // temporary radio pause must not reset it, duplicate it, or drop its tail.
    partialAudio.didWrite(3, now: 3.62)
    precondition(partialAudio.offset == partialAudio.data.count)
    precondition(!partialAudio.isStalled(at: 10))

    // Entirely unsent stale audio can be discarded. A blocked control record
    // cannot be silently discarded and retains its separate two-second limit.
    let unsentAudio = BeaconVoiceWrite(Data([1, 2, 3]), audio: true, now: 0)
    precondition(!unsentAudio.isStalled(at: 3))
    let unsentControl = BeaconVoiceWrite(Data([1]), audio: false, now: 0)
    precondition(!unsentControl.isStalled(at: 1.99))
    precondition(unsentControl.isStalled(at: 2.01))

    print("Voice writes passed: partial-write progress, real stalls, completed frames, stale audio and bounded control waiting.")
  }
}
