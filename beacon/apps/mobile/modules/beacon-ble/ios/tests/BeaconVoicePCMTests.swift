import Foundation
import AVFoundation

// Synthetic samples only: no AVAudioSession, microphone, input node or hardware engine.
// Calls the same acceptance, resampling capacity and framing helper as production.
@main
struct BeaconVoicePCMTests {
  static func rejects(_ label: String, _ work: () throws -> Void) {
    do { try work(); fatalError("Expected rejection: \(label)") } catch { }
  }

  static func main() throws {
    let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
    // These two previously discarded valid speech blocks at separate stages.
    precondition(BeaconVoicePCM.accepts(frameCount: 4800, sampleRate: 48000, channels: 1), "100ms capture must not hit the old fixed 4096-frame cutoff")
    precondition(BeaconVoicePCM.accepts(frameCount: 4096, sampleRate: 16000, channels: 1), "256ms input must be framed, not discarded when converted PCM exceeds 3200 samples")
    var cases = 0
    for rate in [48000.0, 44100.0, 16000.0] {
      for channels: AVAudioChannelCount in [1, 2] {
        for length: AVAudioFrameCount in [960, 4096, 4800, 8192] {
          if Double(length) / rate > 0.3 {
            precondition(!BeaconVoicePCM.accepts(frameCount: Int(length), sampleRate: rate, channels: Int(channels)))
            continue
          }
          precondition(BeaconVoicePCM.accepts(frameCount: Int(length), sampleRate: rate, channels: Int(channels)))
          let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: channels, interleaved: false)!
          let converter = AVAudioConverter(from: format, to: target)!
          var framing = BeaconVoicePCM()
          var produced = 0
          var framed = 0
          var energy = 0.0
          for block in 0..<20 {
            let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: length)!
            input.frameLength = length
            for channel in 0..<Int(channels) {
              for i in 0..<Int(length) {
                input.floatChannelData![channel][i] = Float(0.2 * sin(2 * Double.pi * 440 * Double(block * Int(length) + i) / rate))
              }
            }
            let capacity = BeaconVoicePCM.outputCapacity(frameCount: Int(length), sampleRate: rate)
            let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: AVAudioFrameCount(capacity))!
            var supplied = false
            var error: NSError?
            let status = converter.convert(to: output, error: &error) { _, status in
              if supplied { status.pointee = .noDataNow; return nil }
              supplied = true; status.pointee = .haveData; return input
            }
            precondition(error == nil && status != .error)
            let values = Array(UnsafeBufferPointer(start: output.floatChannelData![0], count: Int(output.frameLength)))
            produced += values.count
            let frames = try framing.append(values)
            for frame in frames {
              precondition(frame.count == 320 * MemoryLayout<Float>.size)
              frame.withUnsafeBytes { bytes in
                for value in bytes.bindMemory(to: Float.self) {
                  precondition(value.isFinite)
                  energy += Double(value * value)
                }
              }
              framed += 320
            }
            // All converted samples must survive framing; only an incomplete tail remains.
            precondition(framing.pendingSamples >= 0 && framing.pendingSamples < 320)
            precondition(framed + framing.pendingSamples == produced, "Framing silently dropped converted speech")
          }
          precondition(framed > 320 && energy > 1, "Accepted capture yielded silence")
          let expected = Double(length) * 20 * 16000 / rate
          precondition(Double(produced) > expected * 0.9 && Double(produced) < expected * 1.1)
          framing.reset()
          precondition(framing.pendingSamples == 0)
          cases += 1
        }
      }
    }
    for (count, rate, channels) in [(0, 48000.0, 1), (-1, 48000.0, 1), (960, 0.0, 1), (960, Double.nan, 1), (960, Double.infinity, 1), (960, 48000.0, 0), (48001, 48000.0, 1)] {
      precondition(!BeaconVoicePCM.accepts(frameCount: count, sampleRate: rate, channels: channels))
    }
    var framing = BeaconVoicePCM()
    let incomplete = try framing.append(Array(repeating: Float(0.2), count: 319))
    precondition(incomplete.isEmpty)
    let frame = try framing.append([0.2])
    precondition(frame.count == 1 && framing.pendingSamples == 0)
    rejects("excessive converted block") { _ = try framing.append(Array(repeating: 0.2, count: 4865)) }
    print("Real AVAudioConverter + production PCM: \(cases) synthetic rate/channel/block cases passed, including 4800@48k and 4096@16k; no microphone accessed")
  }
}
