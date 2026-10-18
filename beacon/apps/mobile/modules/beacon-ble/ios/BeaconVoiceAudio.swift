import AVFoundation

// Microphone/render callbacks never wait for the Bluetooth stream. There are at
// most three capture blocks and six playback frames queued at any time.
final class BeaconVoiceAudio {
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private let queue = DispatchQueue(label: "org.beacon.voice.codec", qos: .userInteractive)
  private let captureSlots = DispatchSemaphore(value: 3)
  private let playbackSlots = DispatchSemaphore(value: 6)
  private var codec: BeaconOpusCodec?
  private var converter: AVAudioConverter?
  private var samples: [Float] = []
  private var running = false
  private var muted = false
  private var tapInstalled = false
  private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
  var onPacket: ((Data) -> Void)?
  var onFailure: (() -> Void)?

  func start(speaker: Bool) throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
    try session.setPreferredSampleRate(48000)
    try session.setPreferredIOBufferDuration(0.02)
    try session.setActive(true)
    try session.overrideOutputAudioPort(speaker ? .speaker : .none)
    try engine.inputNode.setVoiceProcessingEnabled(true)
    let inputFormat = engine.inputNode.outputFormat(forBus: 0)
    guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0, !inputFormat.isInterleaved,
      let converter = AVAudioConverter(from: inputFormat, to: format),
      let codec = BeaconOpusCodec() else { throw BeaconVoiceError.unavailable }
    queue.sync {
      self.converter = converter; self.codec = codec; self.running = true
    }
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: format)
    engine.inputNode.installTap(onBus: 0, bufferSize: 960, format: inputFormat) { [weak self] buffer, _ in
      guard let self, self.captureSlots.wait(timeout: .now()) == .success else { return }
      let capturedAt = ProcessInfo.processInfo.systemUptime
      guard buffer.frameLength <= 4096 else { self.captureSlots.signal(); return }
      guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength),
        let source = buffer.floatChannelData, let target = copy.floatChannelData else {
        self.captureSlots.signal(); return
      }
      copy.frameLength = buffer.frameLength
      for channel in 0..<Int(buffer.format.channelCount) {
        target[channel].update(from: source[channel], count: Int(buffer.frameLength))
      }
      self.queue.async {
        guard self.running, !self.muted, ProcessInfo.processInfo.systemUptime - capturedAt < 0.15 else { self.captureSlots.signal(); return }
        self.encode(copy, capturedAt: capturedAt)
      }
    }
    tapInstalled = true
    engine.prepare()
    try engine.start()
    player.play()
  }

  private func encode(_ input: AVAudioPCMBuffer, capturedAt: TimeInterval) {
    guard let converter, let codec,
      let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(Double(input.frameLength) * 16000 / input.format.sampleRate + 32)) else {
      captureSlots.signal(); return
    }
    var supplied = false
    var error: NSError?
    converter.convert(to: output, error: &error) { _, status in
      if supplied { status.pointee = .noDataNow; return nil }
      supplied = true; status.pointee = .haveData; return input
    }
    guard error == nil, let values = output.floatChannelData?[0] else {
      captureSlots.signal(); DispatchQueue.main.async { [weak self] in self?.onFailure?() }; return
    }
    samples.append(contentsOf: UnsafeBufferPointer(start: values, count: Int(output.frameLength)))
    guard samples.count <= 3200 else { samples.removeAll(); captureSlots.signal(); return }
    var packets: [Data] = []
    while samples.count >= 320 {
      let frame = Array(samples.prefix(320))
      let pcm = frame.withUnsafeBytes { Data($0) }
      samples.removeFirst(320)
      guard let packet = codec.encodeSamples(pcm) else {
        captureSlots.signal(); DispatchQueue.main.async { [weak self] in self?.onFailure?() }; return
      }
      packets.append(packet)
    }
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if ProcessInfo.processInfo.systemUptime - capturedAt < 0.15 {
        for packet in packets { self.onPacket?(packet) }
      }
      self.captureSlots.signal()
    }
  }

  func play(_ packet: Data) {
    guard playbackSlots.wait(timeout: .now()) == .success else { return }
    queue.async { [weak self] in
      guard let self else { return }
      guard self.running, let decoded = self.codec?.decodePacket(packet), decoded.count == 1280,
        let buffer = AVAudioPCMBuffer(pcmFormat: self.format, frameCapacity: 320),
        let destination = buffer.floatChannelData?[0] else {
        self.playbackSlots.signal(); return
      }
      buffer.frameLength = 320
      decoded.withUnsafeBytes { bytes in
        destination.update(from: bytes.bindMemory(to: Float.self).baseAddress!, count: 320)
      }
      self.player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in self?.playbackSlots.signal() }
    }
  }

  func setMuted(_ value: Bool) { queue.sync { self.muted = value; self.samples.removeAll() } }
  func setSpeaker(_ value: Bool) throws { try AVAudioSession.sharedInstance().overrideOutputAudioPort(value ? .speaker : .none) }

  func stop() {
    onPacket = nil; onFailure = nil
    if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    engine.stop()
    queue.sync { running = false; player.stop(); samples.removeAll(); converter = nil; codec = nil }
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}
