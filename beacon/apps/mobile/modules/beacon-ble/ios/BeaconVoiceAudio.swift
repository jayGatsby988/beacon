import AVFoundation

func beaconVoiceTrace(_ message: String) {
  // Operational metadata only: never include audio, call IDs, peers or keys.
  FileHandle.standardOutput.write(Data(("[BeaconVoice] " + message + "\n").utf8))
}

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
  private var pcm = BeaconVoicePCM()
  private let statsLock = NSLock()
  private var counters: [String: Int] = [:]
  private var running = false
  private var muted = false
  private var tapInstalled = false
  private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
  var onPacket: ((Data) -> Void)?
  var onFailure: (() -> Void)?

  @discardableResult private func count(_ key: String, _ amount: Int = 1) -> Int {
    statsLock.lock(); defer { statsLock.unlock() }
    let value = (counters[key] ?? 0) + amount; counters[key] = value; return value
  }

  func statistics() -> [String: Int] {
    statsLock.lock(); defer { statsLock.unlock() }; return counters
  }

  func start(speaker: Bool) throws {
    let session = AVAudioSession.sharedInstance()
    beaconVoiceTrace("audio configure speaker=\(speaker)")
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
    try session.setPreferredSampleRate(48000)
    try session.setPreferredIOBufferDuration(0.02)
    try session.setActive(true)
    try session.overrideOutputAudioPort(speaker ? .speaker : .none)
    try engine.inputNode.setVoiceProcessingEnabled(true)
    let inputFormat = engine.inputNode.outputFormat(forBus: 0)
    beaconVoiceTrace("audio input rate=\(inputFormat.sampleRate) channels=\(inputFormat.channelCount) format=\(inputFormat.commonFormat.rawValue) interleaved=\(inputFormat.isInterleaved) route=\(session.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ","))")
    guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0, !inputFormat.isInterleaved,
      let converter = AVAudioConverter(from: inputFormat, to: format),
      let codec = BeaconOpusCodec() else { throw BeaconVoiceError.unavailable }
    queue.sync {
      self.converter = converter; self.codec = codec; self.running = true
    }
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: format)
    engine.inputNode.installTap(onBus: 0, bufferSize: 960, format: inputFormat) { [weak self] buffer, _ in
      guard let self else { return }
      let block = self.count("tapBlocks")
      self.count("tapFrames", Int(buffer.frameLength))
      if block == 1 {
        let frames = buffer.frameLength; let rate = buffer.format.sampleRate; let channels = buffer.format.channelCount
        DispatchQueue.main.async { beaconVoiceTrace("first tap frames=\(frames) rate=\(rate) channels=\(channels)") }
      }
      guard self.captureSlots.wait(timeout: .now()) == .success else { self.count("captureBackpressureDrops"); return }
      let capturedAt = ProcessInfo.processInfo.systemUptime
      guard BeaconVoicePCM.accepts(frameCount: Int(buffer.frameLength), sampleRate: buffer.format.sampleRate, channels: Int(buffer.format.channelCount)) else {
        let drops = self.count("oversizeCaptureDrops"); self.captureSlots.signal()
        if drops == 1 {
          let frames = buffer.frameLength; let rate = buffer.format.sampleRate
          DispatchQueue.main.async { [weak self] in
            beaconVoiceTrace("unsupported tap block frames=\(frames) rate=\(rate)"); self?.onFailure?()
          }
        }
        return
      }
      guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength),
        let source = buffer.floatChannelData, let target = copy.floatChannelData else {
        self.count("captureFormatErrors"); self.captureSlots.signal()
        DispatchQueue.main.async { [weak self] in self?.onFailure?() }; return
      }
      copy.frameLength = buffer.frameLength
      for channel in 0..<Int(buffer.format.channelCount) {
        target[channel].update(from: source[channel], count: Int(buffer.frameLength))
      }
      if UnsafeBufferPointer(start: source[0], count: Int(buffer.frameLength)).contains(where: { abs($0) > 0.00001 }) { self.count("nonzeroTapBlocks") }
      self.queue.async {
        guard self.running, !self.muted else { self.captureSlots.signal(); return }
        guard ProcessInfo.processInfo.systemUptime - capturedAt < 0.15 else { self.count("staleCaptureDrops"); self.captureSlots.signal(); return }
        self.encode(copy, capturedAt: capturedAt)
      }
    }
    tapInstalled = true
    engine.prepare()
    try engine.start()
    player.play()
    beaconVoiceTrace("audio engine started player=\(player.isPlaying) sampleRate=\(session.sampleRate)")
  }

  private func encode(_ input: AVAudioPCMBuffer, capturedAt: TimeInterval) {
    guard let converter, let codec,
      let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(BeaconVoicePCM.outputCapacity(frameCount: Int(input.frameLength), sampleRate: input.format.sampleRate))) else {
      captureSlots.signal(); return
    }
    var supplied = false
    var error: NSError?
    converter.convert(to: output, error: &error) { _, status in
      if supplied { status.pointee = .noDataNow; return nil }
      supplied = true; status.pointee = .haveData; return input
    }
    guard error == nil, let values = output.floatChannelData?[0] else {
      count("conversionErrors")
      let code = error?.code ?? 0
      DispatchQueue.main.async { beaconVoiceTrace("converter failed code=\(code)") }
      captureSlots.signal(); DispatchQueue.main.async { [weak self] in self?.onFailure?() }; return
    }
    count("convertedSamples", Int(output.frameLength))
    let frames: [Data]
    do { frames = try pcm.append(Array(UnsafeBufferPointer(start: values, count: Int(output.frameLength)))) }
    catch {
      count("pcmFramingErrors"); captureSlots.signal()
      DispatchQueue.main.async { [weak self] in self?.onFailure?() }; return
    }
    var packets: [Data] = []
    for frame in frames {
      guard let packet = codec.encodeSamples(frame) else {
        count("encodeErrors")
        captureSlots.signal(); DispatchQueue.main.async { [weak self] in self?.onFailure?() }; return
      }
      packets.append(packet)
      count("encodedFrames")
    }
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if ProcessInfo.processInfo.systemUptime - capturedAt < 0.15 {
        for packet in packets { self.onPacket?(packet) }
      } else { self.count("staleEncodedDrops", packets.count) }
      self.captureSlots.signal()
    }
  }

  func play(_ packet: Data) {
    guard playbackSlots.wait(timeout: .now()) == .success else { count("playbackBackpressureDrops"); return }
    queue.async { [weak self] in
      guard let self else { return }
      guard self.running, let decoded = self.codec?.decodePacket(packet), decoded.count == 1280,
        let buffer = AVAudioPCMBuffer(pcmFormat: self.format, frameCapacity: 320),
        let destination = buffer.floatChannelData?[0] else {
        self.count("decodeOrPlaybackErrors"); self.playbackSlots.signal(); return
      }
      buffer.frameLength = 320
      decoded.withUnsafeBytes { bytes in
        destination.update(from: bytes.bindMemory(to: Float.self).baseAddress!, count: 320)
      }
      self.count("decodedFrames")
      if UnsafeBufferPointer(start: destination, count: 320).contains(where: { abs($0) > 0.00001 }) { self.count("nonzeroDecodedFrames") }
      self.player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
        self?.count("playedFrames"); self?.playbackSlots.signal()
      }
    }
  }

  func setMuted(_ value: Bool) { queue.sync { self.muted = value; self.pcm.reset() } }
  func setSpeaker(_ value: Bool) throws {
    try AVAudioSession.sharedInstance().overrideOutputAudioPort(value ? .speaker : .none)
    beaconVoiceTrace("speaker=\(value) route=\(AVAudioSession.sharedInstance().currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ","))")
  }

  func stop() {
    onPacket = nil; onFailure = nil
    if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    engine.stop()
    queue.sync { running = false; player.stop(); pcm.reset(); converter = nil; codec = nil }
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}
