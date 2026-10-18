import AVFoundation

// This Foundation-only store is exercised directly by the native diagnostics
// checker. Its caller owns serialization; it never runs on an audio callback.
final class BeaconVoiceTraceStore {
  static let fileLimit = 64 * 1024
  private let directory: URL
  private let now: () -> Date
  private let expiry: TimeInterval = 24 * 60 * 60
  private let formatter = ISO8601DateFormatter()
  private let files: [URL]

  init(directory: URL, now: @escaping () -> Date = Date.init) {
    self.directory = directory; self.now = now
    files = [directory.appendingPathComponent("beacon-voice-diagnostics.log"),
             directory.appendingPathComponent("beacon-voice-diagnostics.previous.log")]
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
  }

  private func prune(_ date: Date) throws {
    for file in files where FileManager.default.fileExists(atPath: file.path) {
      let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
      let size = (attributes[.size] as? NSNumber)?.intValue ?? Int.max
      // Expire by the oldest entry, not the latest append, so continued calls
      // cannot retain old metadata indefinitely. Corrupt/oversized logs go too.
      if size > Self.fileLimit {
        try FileManager.default.removeItem(at: file); continue
      }
      let data = try Data(contentsOf: file)
      let first = String(decoding: data.prefix(64), as: UTF8.self).split(separator: " ").first
      guard let first, let started = formatter.date(from: String(first)),
        date.timeIntervalSince(started) >= 0, date.timeIntervalSince(started) < expiry else {
        try FileManager.default.removeItem(at: file); continue
      }
    }
  }

  func append(_ message: String) throws {
    let date = now()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try prune(date)
    let safe = message.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ")
    let data = Data((formatter.string(from: date) + " [BeaconVoice] " + safe + "\n").utf8)
    guard data.count <= 4096 else { return }
    let current = files[0], previous = files[1]
    if FileManager.default.fileExists(atPath: current.path) {
      let size = (try FileManager.default.attributesOfItem(atPath: current.path)[.size] as? NSNumber)?.intValue ?? Self.fileLimit
      if size + data.count > Self.fileLimit {
        if FileManager.default.fileExists(atPath: previous.path) { try FileManager.default.removeItem(at: previous) }
        try FileManager.default.moveItem(at: current, to: previous)
      }
    }
    if FileManager.default.fileExists(atPath: current.path) {
      let handle = try FileHandle(forWritingTo: current)
      defer { try? handle.close() }
      try handle.seekToEnd(); try handle.write(contentsOf: data)
    } else { try data.write(to: current, options: .atomic) }
  }
}

private final class BeaconVoiceDiagnostics {
  static let shared = BeaconVoiceDiagnostics()
  private let queue = DispatchQueue(label: "org.beacon.voice.diagnostics", qos: .utility)
  private let lock = NSLock()
  private var pending = 0
  private var store: BeaconVoiceTraceStore?

  func append(_ message: String) {
    // Bound memory as well as files if storage stalls. Diagnostic loss must
    // never backpressure the live audio or Bluetooth path.
    guard message.utf8.count <= 4096 else { return }
    lock.lock()
    guard pending < 32 else { lock.unlock(); return }
    pending += 1; lock.unlock()
    queue.async {
      defer { self.lock.lock(); self.pending -= 1; self.lock.unlock() }
      if self.store == nil, let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first {
        self.store = BeaconVoiceTraceStore(directory: directory)
      }
      try? FileHandle.standardOutput.write(contentsOf: Data(("[BeaconVoice] " + message + "\n").utf8))
      try? self.store?.append(message)
    }
  }
}

func beaconVoiceTrace(_ message: String) {
  // Operational metadata only: never include audio, call IDs, peers or keys.
  BeaconVoiceDiagnostics.shared.append(message)
}

// Microphone/render callbacks never wait for the Bluetooth stream. There are at
// most three capture blocks and twelve playback frames (240ms) queued at a time.
final class BeaconVoiceAudio {
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  // Consume the voice-processing input chain independently of whether the peer
  // has sent playback yet. This receiver performs no allocation, dispatch, or
  // locking, and never routes the microphone to the local output.
  private let captureSink = AVAudioSinkNode { _, _, _ in noErr }
  private let queue = DispatchQueue(label: "org.beacon.voice.codec", qos: .userInteractive)
  private let captureSlots = DispatchSemaphore(value: 3)
  private let playbackSlots = DispatchSemaphore(value: BeaconVoicePCM.playbackFrameLimit)
  private var codec: BeaconOpusCodec?
  private var converter: AVAudioConverter?
  private var pcm = BeaconVoicePCM()
  private let statsLock = NSLock()
  private var counters: [String: Int] = [:]
  private var running = false
  private var muted = false
  private var tapInstalled = false
  private var graphInputFormat: AVAudioFormat?
  private var recovering = false
  private let epoch = BeaconVoiceAudioEpoch()
  private var observers: [NSObjectProtocol] = []
  private var captureWatchdog: Timer?
  private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
  var onPacket: ((Data) -> Void)?
  var onFailure: ((String) -> Void)?

  @discardableResult private func count(_ key: String, _ amount: Int = 1) -> Int {
    statsLock.lock(); defer { statsLock.unlock() }
    let value = (counters[key] ?? 0) + amount; counters[key] = value; return value
  }

  func statistics() -> [String: Int] {
    statsLock.lock(); var snapshot = counters; statsLock.unlock()
    snapshot["engineRunning"] = engine.isRunning ? 1 : 0
    snapshot["playerPlaying"] = player.isPlaying ? 1 : 0
    snapshot["sinkRendered"] = captureSink.lastRenderTime?.isSampleTimeValid == true ? 1 : 0
    if let time = captureSink.lastRenderTime, time.isSampleTimeValid { snapshot["sinkSampleTime"] = Int(clamping: time.sampleTime) }
    snapshot["inputRendered"] = engine.inputNode.lastRenderTime?.isSampleTimeValid == true ? 1 : 0
    snapshot["outputRendered"] = engine.outputNode.lastRenderTime?.isSampleTimeValid == true ? 1 : 0
    return snapshot
  }

  private func traceEngine(_ stage: String) {
    let session = AVAudioSession.sharedInstance()
    beaconVoiceTrace("\(stage) engineRunning=\(engine.isRunning) playerPlaying=\(player.isPlaying) sampleRate=\(session.sampleRate) route=\(session.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ","))")
  }

  private func watchCapture() {
    var lastBlocks = 0
    var lastProgress = ProcessInfo.processInfo.systemUptime
    let timer = Timer(timeInterval: 1, repeats: true) { [weak self] timer in
      guard let self, self.tapInstalled else { timer.invalidate(); return }
      let blocks = self.statistics()["tapBlocks"] ?? 0
      let now = ProcessInfo.processInfo.systemUptime
      if blocks != lastBlocks { lastBlocks = blocks; lastProgress = now }
      guard now - lastProgress >= 3 else { return }
      timer.invalidate(); self.captureWatchdog = nil
      let reason = self.engine.isRunning ? "audio_capture_stalled" : "audio_engine_stopped"
      self.traceEngine("capture watchdog failed reason=\(reason) tapBlocks=\(blocks)")
      self.onFailure?(reason)
    }
    captureWatchdog = timer
    RunLoop.main.add(timer, forMode: .common)
  }

  func start(speaker: Bool) throws {
    let session = AVAudioSession.sharedInstance()
    observers.append(NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
      self?.traceEngine("engine configuration changed")
      // The SDK says this notification stops the engine while preserving old
      // connection formats. Reconnect on a later main turn, outside its callback.
      DispatchQueue.main.async { [weak self] in self?.recoverConfiguration() }
    })
    observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
      let reason = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
      self?.traceEngine("audio route event reason=\(reason)")
    })
    observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
      let type = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt ?? 0
      self?.traceEngine("audio interruption type=\(type)")
    })
    observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
      self?.traceEngine("audio media services reset")
      // Audio objects are invalid after a media-server reset. A new call must
      // create a fresh engine instead of leaving an apparently active silent one.
      guard let self, self.tapInstalled else { return }
      self.onFailure?("audio_engine_stopped")
    })
    beaconVoiceTrace("audio configure speaker=\(speaker)")
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
    try session.setPreferredSampleRate(48000)
    try session.setPreferredIOBufferDuration(0.02)
    try session.setActive(true)
    try session.overrideOutputAudioPort(speaker ? .speaker : .none)
    engine.isAutoShutdownEnabled = false
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
    engine.attach(captureSink)
    engine.connect(engine.inputNode, to: captureSink, format: inputFormat)
    engine.connect(player, to: engine.mainMixerNode, format: format)
    // Use the same I/O client format for both halves of VoiceProcessingIO, as
    // Apple's UsingVoiceProcessing sample does; the mixer converts Opus's16k.
    engine.connect(engine.mainMixerNode, to: engine.outputNode, format: inputFormat)
    graphInputFormat = inputFormat
    beaconVoiceTrace("audio graph inputSink=true explicitOutput=true ioRate=\(inputFormat.sampleRate) ioChannels=\(inputFormat.channelCount) autoShutdown=\(engine.isAutoShutdownEnabled)")
    installCaptureTap(inputFormat, epoch: epoch.begin())
    engine.prepare()
    try engine.start()
    player.play()
    watchCapture()
    beaconVoiceTrace("audio engine started player=\(player.isPlaying) sampleRate=\(session.sampleRate)")
  }

  private func installCaptureTap(_ inputFormat: AVAudioFormat, epoch generation: UInt64) {
    engine.inputNode.installTap(onBus: 0, bufferSize: 960, format: inputFormat) { [weak self] buffer, _ in
      guard let self, self.epoch.contains(generation) else { return }
      let block = self.count("tapBlocks")
      self.count("tapFrames", Int(buffer.frameLength))
      if block == 1 {
        let frames = buffer.frameLength; let rate = buffer.format.sampleRate; let channels = buffer.format.channelCount
        DispatchQueue.main.async { beaconVoiceTrace("first tap frames=\(frames) rate=\(rate) channels=\(channels)") }
      }
      guard let permit = BeaconVoiceAudioPermit(self.captureSlots) else { self.count("captureBackpressureDrops"); return }
      let capturedAt = ProcessInfo.processInfo.systemUptime
      guard BeaconVoicePCM.accepts(frameCount: Int(buffer.frameLength), sampleRate: buffer.format.sampleRate, channels: Int(buffer.format.channelCount)) else {
        let drops = self.count("oversizeCaptureDrops"); permit.release()
        if drops == 1 {
          let frames = buffer.frameLength; let rate = buffer.format.sampleRate
          DispatchQueue.main.async { [weak self] in
            guard let self, self.epoch.contains(generation) else { return }
            beaconVoiceTrace("unsupported tap block frames=\(frames) rate=\(rate)"); self.onFailure?("audio_codec_failed")
          }
        }
        return
      }
      guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength),
        let source = buffer.floatChannelData, let target = copy.floatChannelData else {
        self.count("captureFormatErrors"); permit.release()
        self.failCodec(epoch: generation); return
      }
      copy.frameLength = buffer.frameLength
      for channel in 0..<Int(buffer.format.channelCount) {
        target[channel].update(from: source[channel], count: Int(buffer.frameLength))
      }
      if UnsafeBufferPointer(start: source[0], count: Int(buffer.frameLength)).contains(where: { abs($0) > 0.00001 }) { self.count("nonzeroTapBlocks") }
      self.queue.async {
        guard self.running, !self.muted, self.epoch.contains(generation) else { permit.release(); return }
        guard ProcessInfo.processInfo.systemUptime - capturedAt < 0.15 else { self.count("staleCaptureDrops"); permit.release(); return }
        self.encode(copy, capturedAt: capturedAt, epoch: generation, permit: permit)
      }
    }
    tapInstalled = true
  }

  private func recoverConfiguration() {
    guard tapInstalled, !recovering else { return }
    let inputFormat = engine.inputNode.outputFormat(forBus: 0)
    if engine.isRunning, player.isPlaying, graphInputFormat == inputFormat { return }
    recovering = true
    defer { recovering = false }
    captureWatchdog?.invalidate(); captureWatchdog = nil
    epoch.end()
    engine.inputNode.removeTap(onBus: 0); tapInstalled = false
    engine.stop()
    queue.sync { running = false; player.stop(); pcm.reset(); converter = nil }
    guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0, !inputFormat.isInterleaved,
      let replacement = AVAudioConverter(from: inputFormat, to: format) else {
      onFailure?("audio_engine_stopped"); return
    }
    engine.disconnectNodeOutput(engine.inputNode)
    engine.disconnectNodeOutput(engine.mainMixerNode)
    engine.connect(engine.inputNode, to: captureSink, format: inputFormat)
    engine.connect(engine.mainMixerNode, to: engine.outputNode, format: inputFormat)
    graphInputFormat = inputFormat
    queue.sync { converter = replacement; running = true }
    installCaptureTap(inputFormat, epoch: epoch.begin())
    do {
      engine.prepare(); try engine.start(); player.play(); watchCapture()
      count("configurationRecoveries")
      traceEngine("audio configuration recovered")
    } catch {
      beaconVoiceTrace("audio configuration restart failed code=\((error as NSError).code)")
      onFailure?("audio_engine_stopped")
    }
  }

  private func encode(_ input: AVAudioPCMBuffer, capturedAt: TimeInterval, epoch generation: UInt64, permit: BeaconVoiceAudioPermit) {
    guard let converter, let codec,
      let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(BeaconVoicePCM.outputCapacity(frameCount: Int(input.frameLength), sampleRate: input.format.sampleRate))) else {
      permit.release(); return
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
      permit.release(); failCodec(epoch: generation); return
    }
    count("convertedSamples", Int(output.frameLength))
    let frames: [Data]
    do { frames = try pcm.append(Array(UnsafeBufferPointer(start: values, count: Int(output.frameLength)))) }
    catch {
      count("pcmFramingErrors"); permit.release()
      failCodec(epoch: generation); return
    }
    var packets: [Data] = []
    for frame in frames {
      guard let packet = codec.encodeSamples(frame) else {
        count("encodeErrors")
        permit.release(); failCodec(epoch: generation); return
      }
      packets.append(packet)
      count("encodedFrames")
    }
    DispatchQueue.main.async { [weak self] in
      defer { permit.release() }
      guard let self else { return }
      if self.epoch.contains(generation), ProcessInfo.processInfo.systemUptime - capturedAt < 0.15 {
        for packet in packets { self.onPacket?(packet) }
      } else { self.count("staleEncodedDrops", packets.count) }
    }
  }

  private func failCodec(epoch generation: UInt64) {
    DispatchQueue.main.async { [weak self] in
      guard let self, self.epoch.contains(generation) else { return }
      self.onFailure?("audio_codec_failed")
    }
  }

  func play(_ packet: Data) {
    guard let generation = epoch.current() else { return }
    guard let permit = BeaconVoiceAudioPermit(playbackSlots) else { count("playbackBackpressureDrops"); return }
    queue.async { [weak self] in
      guard let self else { permit.release(); return }
      guard self.running, self.epoch.contains(generation), let decoded = self.codec?.decodePacket(packet), decoded.count == 1280,
        let buffer = AVAudioPCMBuffer(pcmFormat: self.format, frameCapacity: 320),
        let destination = buffer.floatChannelData?[0] else {
        self.count("decodeOrPlaybackErrors"); permit.release(); return
      }
      buffer.frameLength = 320
      decoded.withUnsafeBytes { bytes in
        destination.update(from: bytes.bindMemory(to: Float.self).baseAddress!, count: 320)
      }
      self.count("decodedFrames")
      if UnsafeBufferPointer(start: destination, count: 320).contains(where: { abs($0) > 0.00001 }) { self.count("nonzeroDecodedFrames") }
      self.player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
        defer { permit.release() }
        guard let self else { return }
        // AVAudioPlayerNode invokes this completion on stop too. A flushed
        // frame must release its slot without claiming audible playback.
        if self.epoch.contains(generation) { self.count("playedFrames") }
        else { self.count("flushedPlaybackFrames") }
      }
    }
  }

  func setMuted(_ value: Bool) { queue.sync { self.muted = value; self.pcm.reset() } }
  func setSpeaker(_ value: Bool) throws {
    try AVAudioSession.sharedInstance().overrideOutputAudioPort(value ? .speaker : .none)
    beaconVoiceTrace("speaker=\(value) route=\(AVAudioSession.sharedInstance().currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ","))")
  }

  func stop() {
    epoch.end()
    captureWatchdog?.invalidate(); captureWatchdog = nil
    traceEngine("audio stopping")
    for observer in observers { NotificationCenter.default.removeObserver(observer) }; observers.removeAll()
    onPacket = nil; onFailure = nil
    if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    graphInputFormat = nil
    engine.stop()
    queue.sync { running = false; player.stop(); pcm.reset(); converter = nil; codec = nil }
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}
