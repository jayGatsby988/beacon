import Foundation
import AVFoundation

// Local synthetic regression, not a microphone, radio or speaker test.
// Uses the actual production Objective-C wrapper (VOIP + VOICE + DTX) and PCM framer.
@main
struct BeaconVoiceCodecPipelineTests {
  // Render synthetic speech with the real AVAudioPlayerNode in offline mode.
  // Two100ms radio bursts can arrive before playback advances; the old6-slot
  // limit dropped four of these ten frames even on a healthy audio engine.
  static func checkPlaybackBursts() throws {
    guard let encoder = BeaconOpusCodec(), let decoder = BeaconOpusCodec() else { fatalError("Opus unavailable") }
    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
    engine.attach(player); engine.connect(player, to: engine.mainMixerNode, format: format)
    try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
    try engine.start(); player.play()
    defer { player.stop(); engine.stop() }
    let slots = DispatchSemaphore(value: BeaconVoicePCM.playbackFrameLimit)
    var admitted = 0
    for frame in 0..<15 {
      let radiansPerSample = 2.0 * Double.pi * 440.0 / 16000.0
      let values: [Float] = (0..<320).map { sample in
        let position = Double(frame * 320 + sample)
        return Float(0.2 * sin(radiansPerSample * position))
      }
      let pcm = values.withUnsafeBytes { Data($0) }
      guard let packet = encoder.encodeSamples(pcm), let decoded = decoder.decodePacket(packet) else { fatalError("Codec failure") }
      guard let permit = BeaconVoiceAudioPermit(slots) else {
        precondition(frame >= 10, "Playback dropped speech from two adjacent100ms capture bursts")
        continue
      }
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 320)!
      buffer.frameLength = 320
      decoded.withUnsafeBytes { data in
        buffer.floatChannelData![0].update(from: data.bindMemory(to: Float.self).baseAddress!, count: 320)
      }
      player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { _ in permit.release() }
      admitted += 1
    }
    precondition(admitted == 12, "Playback must stay bounded at240ms rather than accumulate delay")
    let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)!
    let result = try engine.renderOffline(4096, to: output)
    precondition(result == .success)
    let samples = UnsafeBufferPointer(start: output.floatChannelData![0], count: Int(output.frameLength))
    let energy = samples.reduce(0.0) { $0 + Double($1 * $1) }
    precondition(energy > 1, "Admitted speech must reach the rendered output, not only the decoder")
    // Offline rendering has no speaker clock, so it cannot assert the live
    // .dataPlayedBack callback timing. Check actual rendered samples here;
    // physical playback and callback progress remain a separate device check.
    print("Native offline playback: two 100ms bursts retained, overflow bounded at240ms, nonzero output rendered; no audio hardware accessed")
  }

  static func main() throws {
    try checkPlaybackBursts()
    guard let sender = BeaconOpusCodec(), let receiver = BeaconOpusCodec() else {
      fatalError("Production Opus wrapper initialization failed")
    }
    let firstSpeech = 0..<100
    let silence = 100..<250
    let resumedSpeech = 250..<350
    var input: [Float] = []
    var noise: UInt32 = 0x12345678
    for frame in 0..<350 {
      for sample in 0..<320 {
        let t = Double(frame * 320 + sample) / 16000
        if silence.contains(frame) { input.append(0); continue }
        noise = noise &* 1664525 &+ 1013904223
        let breath = (Double(noise) / Double(UInt32.max) - 0.5) * 0.006
        let envelope = 0.5 + 0.5 * pow(sin(2 * Double.pi * 2.3 * t), 2)
        let fundamental = sin(2 * Double.pi * (135 * t + 0.5 * sin(2 * Double.pi * 1.2 * t)))
        let formants = 0.3 * sin(2 * Double.pi * 700 * t) + 0.2 * sin(2 * Double.pi * 1200 * t) + 0.1 * sin(2 * Double.pi * 2300 * t)
        input.append(Float(0.18 * envelope * (0.6 * fundamental + formants) + breath))
      }
    }

    // Real capture blocks may cross codec frames and exceed the old 3200-sample cap.
    let blockSizes = [17, 319, 960, 4096, 4800, 53]
    var framer = BeaconVoicePCM()
    var offset = 0, block = 0, frames = 0, dtxPackets = 0, resumedNormalPackets = 0
    var inputEnergy = [Double](repeating: 0, count: 3)
    var outputEnergy = [Double](repeating: 0, count: 3)
    var sampleCounts = [Int](repeating: 0, count: 3)
    while offset < input.count {
      let length = min(blockSizes[block % blockSizes.count], input.count - offset)
      precondition(BeaconVoicePCM.accepts(frameCount: length, sampleRate: 16000, channels: 1))
      let pcmFrames = try framer.append(Array(input[offset..<(offset + length)]))
      offset += length; block += 1
      for pcm in pcmFrames {
        precondition(pcm.count == 1280, "Production PCM must contain 320 Float32 samples")
        guard let packet = sender.encodeSamples(pcm), let decoded = receiver.decodePacket(packet) else {
          fatalError("Production encode/decode failed at frame \(frames)")
        }
        precondition(packet.count > 0 && packet.count <= 256)
        precondition(decoded.count == 1280, "Production decoder must recover exactly 20ms")
        if silence.contains(frames) && frames > silence.lowerBound + 50 && packet.count <= 2 { dtxPackets += 1 }
        if resumedSpeech.contains(frames) && packet.count > 2 { resumedNormalPackets += 1 }
        let phase = firstSpeech.contains(frames) ? 0 : silence.contains(frames) ? 1 : 2
        let start = phase == 0 ? firstSpeech.lowerBound : phase == 1 ? silence.lowerBound : resumedSpeech.lowerBound
        // Allow normal encoder delay and DTX transition settling before energy comparison.
        if frames >= start + 20 {
          pcm.withUnsafeBytes { bytes in
            for value in bytes.bindMemory(to: Float.self) { inputEnergy[phase] += Double(value * value) }
          }
          decoded.withUnsafeBytes { bytes in
            for value in bytes.bindMemory(to: Float.self) {
              precondition(value.isFinite)
              outputEnergy[phase] += Double(value * value)
              sampleCounts[phase] += 1
            }
          }
        }
        frames += 1
      }
    }
    precondition(frames == 350 && framer.pendingSamples == 0)
    precondition(dtxPackets > 0, "Synthetic silence must exercise the wrapper's enabled DTX path")
    precondition(resumedNormalPackets > 80, "Speech must leave DTX rather than remain silent")
    for phase in [0, 2] {
      let rms = sqrt(outputEnergy[phase] / Double(sampleCounts[phase]))
      precondition(rms > 0.01, "Production wrapper recovered inaudibly small synthetic signal")
      precondition(outputEnergy[phase] > inputEnergy[phase] * 0.1)
      precondition(outputEnergy[phase] < inputEnergy[phase] * 4)
    }
    let silenceRms = sqrt(outputEnergy[1] / Double(sampleCounts[1]))
    precondition(silenceRms < 0.01, "Silence must not become sustained signal")
    precondition(sender.encodeSamples(Data()) == nil)
    precondition(receiver.decodePacket(Data()) == nil)
    precondition(receiver.decodePacket(Data(repeating: 0, count: 257)) == nil)
    print("Production ObjC Opus + PCM: 350 synthetic speech/silence/speech frames passed; DTX packets=\(dtxPackets), recovered RMS=\(String(format: "%.4f", sqrt(outputEnergy[0] / Double(sampleCounts[0]))))/\(String(format: "%.4f", sqrt(outputEnergy[2] / Double(sampleCounts[2])))); local synthetic only, no hardware audio tested")
  }
}
