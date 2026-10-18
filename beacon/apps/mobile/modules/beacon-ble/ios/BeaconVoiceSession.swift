import Foundation
import CoreBluetooth
import AVFoundation
import UIKit
import ExpoModulesCore

final class BeaconVoiceSession: NSObject, StreamDelegate {
  let callId: String
  let peerId: String
  let expectedPeer: CBPeer
  let initiator: Bool
  var psm: CBL2CAPPSM = 0
  private(set) var closed = false
  private var finishing = false
  private var channel: CBL2CAPChannel?
  private let crypto: BeaconVoiceCrypto
  private let emit: ([String: Any]) -> Void
  private let onEnd: (BeaconVoiceSession) -> Void
  private var receivedHello = false
  private var ready = false
  private var active = false
  private var muted = false
  private var speaker = false
  private var audio: BeaconVoiceAudio?
  private var startPromise: Promise?
  private var readBuffer = Data()
  private var writes: [BeaconVoiceWrite] = []
  private var timer: Timer?
  private var observers: [NSObjectProtocol] = []
  private let created = ProcessInfo.processInfo.systemUptime
  private var attachedAt: TimeInterval?
  private var lastReceived = ProcessInfo.processInfo.systemUptime
  private var lastPing = ProcessInfo.processInfo.systemUptime
  private var sentFrames = 0
  private var receivedFrames = 0
  private var droppedFrames = 0
  private var sentBytes = 0
  private var receivedBytes = 0
  private var preActiveFrames = 0

  init(callId: String, peerId: String, peer: CBPeer, key: Data, initiator: Bool,
       emit: @escaping ([String: Any]) -> Void, onEnd: @escaping (BeaconVoiceSession) -> Void) throws {
    self.callId = callId; self.peerId = peerId; self.expectedPeer = peer; self.initiator = initiator
    self.crypto = try BeaconVoiceCrypto(callId: callId, key: key, initiator: initiator)
    self.emit = emit; self.onEnd = onEnd
    super.init()
    timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.tick() }
    observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.finish("background", failed: false) })
    observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
      if (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue {
        self?.finish("audio_interrupted", failed: false)
      }
    })
    observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
      if (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
        self?.finish("audio_route_lost", failed: false)
      }
    })
  }

  func attach(_ channel: CBL2CAPChannel) {
    guard !closed, self.channel == nil, channel.peer.identifier == expectedPeer.identifier,
      channel.psm == psm else {
      channel.inputStream.close(); channel.outputStream.close(); return
    }
    self.channel = channel; attachedAt = ProcessInfo.processInfo.systemUptime
    beaconVoiceTrace("stream attached role=\(initiator ? "opener" : "listener")")
    for stream in [channel.inputStream as Stream, channel.outputStream as Stream] {
      stream.delegate = self; stream.schedule(in: .main, forMode: .common); stream.open()
    }
    enqueue(crypto.hello(), audio: false)
  }

  func stream(_ stream: Stream, handle eventCode: Stream.Event) {
    guard !closed, let channel, stream === channel.inputStream || stream === channel.outputStream else { return }
    if eventCode.contains(.errorOccurred) || eventCode.contains(.endEncountered) { finish("stream_closed", failed: true); return }
    if eventCode.contains(.hasBytesAvailable) { read() }
    if eventCode.contains(.hasSpaceAvailable) || eventCode.contains(.openCompleted) { pump() }
  }

  private func read() {
    guard let input = channel?.inputStream else { return }
    var bytes = [UInt8](repeating: 0, count: 512)
    for _ in 0..<8 {
      guard !closed, input.hasBytesAvailable else { return }
      let count = input.read(&bytes, maxLength: bytes.count)
      if count < 0 { finish("stream_read_failed", failed: true); return }
      if count == 0 { return }
      receivedBytes += count
      readBuffer.append(contentsOf: bytes.prefix(count))
      guard readBuffer.count <= 1024 else { finish("stream_frame_limit", failed: true); return }
      while readBuffer.count >= 2 {
        let length = Int(readBuffer[0]) * 256 + Int(readBuffer[1])
        guard length > 0, length <= 282 else { finish("invalid_voice_frame", failed: true); return }
        guard readBuffer.count >= length + 2 else { break }
        let record = readBuffer.subdata(in: 2..<(length + 2))
        readBuffer = Data(readBuffer.dropFirst(length + 2))
        receive(record)
        if closed { return }
      }
    }
  }

  private func receive(_ record: Data) {
    do {
      if !receivedHello {
        try crypto.acceptHello(record); receivedHello = true
        beaconVoiceTrace("stream peer challenge authenticated")
        enqueue(try crypto.seal(Data([1])), audio: false)
        return
      }
      let plaintext = try crypto.open(record)
      guard let kind = plaintext.first else { throw BeaconVoiceError.invalid }
      lastReceived = ProcessInfo.processInfo.systemUptime
      switch kind {
      case 1:
        guard !ready, plaintext.count == 1 else { throw BeaconVoiceError.invalid }
        ready = true; beaconVoiceTrace("stream ready authenticated"); emit(["callId": callId, "state": "ready"])
      case 2:
        guard ready, plaintext.count > 1, plaintext.count <= 257 else { throw BeaconVoiceError.invalid }
        if active { receivedFrames += 1; audio?.play(Data(plaintext.dropFirst())) }
        else { preActiveFrames += 1 }
      case 3:
        guard ready, plaintext.count == 1 else { throw BeaconVoiceError.invalid }
        finish("remote_ended", failed: false)
      case 4:
        guard ready, plaintext.count == 1 else { throw BeaconVoiceError.invalid }
      default: throw BeaconVoiceError.invalid
      }
    } catch { finish("voice_authentication_failed", failed: true) }
  }

  private func enqueue(_ record: Data, audio: Bool) {
    guard !closed else { return }
    if audio {
      let now = ProcessInfo.processInfo.systemUptime
      let overLimit = writes.count >= 6
      writes.removeAll { job in
        if job.audio && job.offset == 0 && (now - job.created > 0.15 || overLimit) {
          droppedFrames += 1; return true
        }
        return false
      }
    }
    guard writes.count < 12 else { finish("voice_backpressure", failed: true); return }
    writes.append(BeaconVoiceWrite(record, audio: audio)); pump()
  }

  private func pump() {
    guard !closed, let output = channel?.outputStream else { return }
    while output.hasSpaceAvailable, let job = writes.first {
      let age = ProcessInfo.processInfo.systemUptime - job.created
      if job.audio && job.offset == 0 && age > 0.15 { writes.removeFirst(); droppedFrames += 1; continue }
      let written = job.data.withUnsafeBytes { bytes in
        output.write(bytes.bindMemory(to: UInt8.self).baseAddress!.advanced(by: job.offset), maxLength: job.data.count - job.offset)
      }
      if written < 0 { finish("stream_write_failed", failed: true); return }
      if written == 0 { return }
      sentBytes += written
      job.didWrite(written)
      if job.offset == job.data.count { writes.removeFirst(); if job.audio { sentFrames += 1 } }
    }
  }

  private func tick() {
    guard !closed else { return }
    let now = ProcessInfo.processInfo.systemUptime
    if (!ready && now - (attachedAt ?? created) > (attachedAt == nil ? 45 : 12)) || (ready && now - lastReceived > 10) {
      finish("voice_timeout", failed: true); return
    }
    if let first = writes.first, first.isStalled(at: now) {
      finish("voice_backpressure", failed: true); return
    }
    read(); pump()
    if ready && now - lastPing > 2 {
      lastPing = now
      traceStatistics("live")
      do { enqueue(try crypto.seal(Data([4])), audio: false) }
      catch { finish("voice_encryption_failed", failed: true) }
    }
  }

  func start(_ promise: Promise) {
    guard !closed, ready, !active, startPromise == nil, UIApplication.shared.applicationState == .active else {
      promise.reject("VOICE_NOT_READY", "Call must be accepted, authenticated, and in the foreground"); return
    }
    startPromise = promise
    let session = AVAudioSession.sharedInstance()
    beaconVoiceTrace("audio start permission=\(session.recordPermission.rawValue)")
    if session.recordPermission == .undetermined {
      session.requestRecordPermission { [weak self] allowed in DispatchQueue.main.async { self?.beginAudio(allowed) } }
    } else { beginAudio(session.recordPermission == .granted) }
  }

  private func beginAudio(_ permitted: Bool) {
    guard !closed, let promise = startPromise else { return }
    guard permitted, UIApplication.shared.applicationState == .active else { finish("microphone_unavailable", failed: true); return }
    let engine = BeaconVoiceAudio(); audio = engine
    engine.onPacket = { [weak self] packet in
      guard let self, self.active, !self.closed, !self.muted else { return }
      do { self.enqueue(try self.crypto.seal(Data([2]) + packet), audio: true) }
      catch { self.finish("voice_encryption_failed", failed: true) }
    }
    engine.onFailure = { [weak self] reason in self?.finish(reason, failed: true) }
    do {
      try engine.start(speaker: speaker); engine.setMuted(muted)
      active = true; startPromise = nil; promise.resolve(nil)
      emit(["callId": callId, "state": "active"])
    } catch {
      let nativeError = error as NSError
      beaconVoiceTrace("audio start failed domain=\(nativeError.domain) code=\(nativeError.code)")
      finish("audio_start_failed", failed: true)
    }
  }

  func setMuted(_ value: Bool) {
    muted = value; audio?.setMuted(value)
    if value { writes.removeAll(where: { $0.audio && $0.offset == 0 }) }
  }
  func setSpeaker(_ value: Bool) throws { speaker = value; if active { try audio?.setSpeaker(value) } }

  func finish(_ reason: String, failed: Bool) {
    guard !closed, !finishing else { return }
    finishing = true
    traceStatistics("end reason=\(reason)")
    // Best-effort encrypted end marker. Stream closure remains authoritative.
    if ready, reason != "remote_ended", let record = try? crypto.seal(Data([3])) {
      writes.removeAll(where: { $0.offset == 0 }); writes.append(BeaconVoiceWrite(record, audio: false)); pump()
      if closed { return }
    }
    closed = true; active = false
    startPromise?.reject("VOICE_ENDED", reason); startPromise = nil
    timer?.invalidate(); timer = nil
    for observer in observers { NotificationCenter.default.removeObserver(observer) }; observers.removeAll()
    audio?.stop(); audio = nil
    if let channel {
      for stream in [channel.inputStream as Stream, channel.outputStream as Stream] {
        stream.delegate = nil; stream.close(); stream.remove(from: .main, forMode: .common)
      }
    }
    channel = nil; writes.removeAll(); readBuffer.removeAll()
    emit(["callId": callId, "state": failed ? "failed" : "ended", "reason": reason,
          "stats": ["sentFrames": sentFrames, "receivedFrames": receivedFrames, "droppedFrames": droppedFrames]])
    onEnd(self)
  }

  private func traceStatistics(_ stage: String) {
    let stats = audio?.statistics() ?? [:]
    let values = stats.keys.sorted().map { "\($0)=\(stats[$0]!)" }.joined(separator: " ")
    beaconVoiceTrace("\(stage) active=\(active) txFrames=\(sentFrames) rxFrames=\(receivedFrames) txBytes=\(sentBytes) rxBytes=\(receivedBytes) drops=\(droppedFrames) preActive=\(preActiveFrames) queued=\(writes.count) \(values)")
  }
}
