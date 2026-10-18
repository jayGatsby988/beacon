import ExpoModulesCore
import CoreBluetooth
import UIKit

public class BeaconBleModule: Module {
  private var transport: BeaconTransport?
  public func definition() -> ModuleDefinition {
    Name("BeaconBle")
    Events("onPeer", "onData", "onState", "onError", "onVoice")
    AsyncFunction("getVoiceSupport") { (promise: Promise) in
      DispatchQueue.main.async { promise.resolve(BeaconTransport.voiceSupport()) }
    }
    AsyncFunction("voicePrepare") { (options: [String: Any], promise: Promise) in DispatchQueue.main.async {
      guard let transport = self.transport else { promise.reject("NOT_STARTED", "Start Bluetooth first"); return }
      transport.voicePrepare(options, promise: promise)
    } }
    AsyncFunction("voiceConnect") { (options: [String: Any], promise: Promise) in DispatchQueue.main.async {
      guard let transport = self.transport else { promise.reject("NOT_STARTED", "Start Bluetooth first"); return }
      transport.voiceConnect(options, promise: promise)
    } }
    AsyncFunction("voiceStart") { (callId: String, promise: Promise) in DispatchQueue.main.async {
      guard let transport = self.transport else { promise.reject("NOT_STARTED", "Start Bluetooth first"); return }
      transport.voiceStart(callId, promise: promise)
    } }
    AsyncFunction("voiceStop") { (callId: String, promise: Promise) in DispatchQueue.main.async {
      self.transport?.voiceStop(callId); promise.resolve(nil)
    } }
    AsyncFunction("voiceSetMuted") { (muted: Bool, promise: Promise) in DispatchQueue.main.async {
      self.transport?.voiceSetMuted(muted); promise.resolve(nil)
    } }
    AsyncFunction("voiceSetSpeaker") { (speaker: Bool, promise: Promise) in DispatchQueue.main.async {
      do { try self.transport?.voiceSetSpeaker(speaker); promise.resolve(nil) }
      catch { promise.reject("AUDIO_ROUTE_FAILED", "Could not change the audio output") }
    } }
    AsyncFunction("start") { (options: [String: String], promise: Promise) in
      DispatchQueue.main.async {
        guard let nodeId = options["nodeId"], !nodeId.isEmpty else { promise.reject("INVALID_ID", "A nodeId is required"); return }
        if self.transport == nil { self.transport = BeaconTransport { [weak self] event, body in self?.sendEvent(event, body) } }
        self.transport!.start(service: options["serviceUuid"], promise: promise)
      }
    }
    AsyncFunction("stop") { (promise: Promise) in DispatchQueue.main.async { self.transport?.stop(); promise.resolve(nil) } }
    AsyncFunction("getState") { (promise: Promise) in DispatchQueue.main.async { promise.resolve(self.transport?.state() ?? ["state": "unknown", "advertising": false, "scanning": false]) } }
    AsyncFunction("send") { (peer: String, base64: String, promise: Promise) in DispatchQueue.main.async {
      guard let t = self.transport else { promise.reject("NOT_STARTED", "Start Bluetooth first"); return }
      t.send(peer: peer, base64: base64, promise: promise)
    } }
    OnDestroy { DispatchQueue.main.async { self.transport?.stop(); self.transport = nil } }
  }
}

private final class BeaconSend {
  let frames: [Data]; let promise: Promise; var index = 0; let started = ProcessInfo.processInfo.systemUptime
  init(_ frames: [Data], _ promise: Promise) { self.frames = frames; self.promise = promise }
}
private final class BeaconLink {
  let id: String; var peripheral: CBPeripheral?; var central: CBCentral?
  var write: CBCharacteristic?; var notify: CBCharacteristic?; var ready = false
  var queue: [BeaconSend] = []; var pending = false; let rx = BeaconReassembler(); let created = ProcessInfo.processInfo.systemUptime
  init(_ id: String) { self.id = id }
}
private final class BeaconTransport: NSObject, CBCentralManagerDelegate, CBPeripheralManagerDelegate, CBPeripheralDelegate {
  private let emit: (String, [String: Any]) -> Void
  private var centralManager: CBCentralManager!; private var peripheralManager: CBPeripheralManager!
  private var wanted = false; private var serviceReady = false
  private var publishedService: CBMutableService?; private var advertisingPending = false
  private var service = CBUUID(string: "7C51A100-1B15-4F0D-9B8D-0E4B8D638010")
  private let writeId = CBUUID(string: "7C51A101-1B15-4F0D-9B8D-0E4B8D638010")
  private let notifyId = CBUUID(string: "7C51A102-1B15-4F0D-9B8D-0E4B8D638010")
  private var retiring: [UUID: (CBPeripheral, TimeInterval)] = [:]
  private var outgoing: [UUID: BeaconLink] = [:]; private var incoming: [UUID: BeaconLink] = [:]
  private var notifyChar: CBMutableCharacteristic?; private var timer: Timer?
  private var cooldown: [UUID: (TimeInterval, Int)] = [:]; private var sequence = UInt32.random(in: 0...UInt32.max)
  private var voice: BeaconVoiceSession?
  private var voicePublishPending: String?
  private var voicePublishPromise: Promise?
  private var voiceOpenPending: BeaconVoiceSession?
  init(emit: @escaping (String, [String: Any]) -> Void) {
    self.emit = emit; super.init()
    centralManager = CBCentralManager(delegate: self, queue: .main)
    peripheralManager = CBPeripheralManager(delegate: self, queue: .main)
  }
  func state() -> [String: Any] {
    let s = centralManager.state
    let name = s == .poweredOn ? "poweredOn" : s == .poweredOff ? "poweredOff" : s == .unauthorized ? "unauthorized" : s == .unsupported ? "unsupported" : "unknown"
    return ["state": name, "advertising": peripheralManager.isAdvertising, "scanning": centralManager.isScanning]
  }
  private func stateEvent() { emit("onState", state()) }
  private func trace(_ stage: String) {
    // Operational stages only: never log message contents, location, or node identity.
    NSLog("[BeaconBLE] %@", stage)
  }
  private func error(_ code: String, _ message: String, _ peer: String? = nil) {
    trace("error \(code): \(message)")
    var body: [String: Any] = ["code": code, "message": "\(code): \(message)"]; if let peer { body["peerId"] = peer }; emit("onError", body)
  }
  func start(service value: String?, promise: Promise) {
    if let value, UUID(uuidString: value) == nil { promise.reject("INVALID_UUID", "Invalid service UUID"); return }
    if wanted { promise.resolve(state()); return }
    if let value { service = CBUUID(string: value) }
    voicePublishPromise?.reject("STOPPED", "Bluetooth restarted")
    voicePublishPromise = nil; voicePublishPending = nil; voiceOpenPending = nil
    // Fresh managers isolate queued callbacks from a prior stop/start lifecycle.
    centralManager.delegate = nil; peripheralManager.delegate = nil
    centralManager = CBCentralManager(delegate: self, queue: .main)
    peripheralManager = CBPeripheralManager(delegate: self, queue: .main)
    wanted = true
    trace("start requested")
    timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.tick() }
    activate(); promise.resolve(state())
  }
  private func activate() {
    guard wanted else { return }
    if centralManager.state == .poweredOn && !centralManager.isScanning {
      trace("starting filtered scan")
      centralManager.scanForPeripherals(withServices: [service], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    }
    if peripheralManager.state == .poweredOn && !serviceReady {
      serviceReady = true
      let s = CBMutableService(type: service, primary: true)
      let w = CBMutableCharacteristic(type: writeId, properties: [.write], value: nil, permissions: [.writeable])
      let n = CBMutableCharacteristic(type: notifyId, properties: [.notify], value: nil, permissions: [])
      trace("publishing service")
      notifyChar = n; s.characteristics = [w, n]; publishedService = s; peripheralManager.add(s)
    }
    if peripheralManager.state == .poweredOn && serviceReady && publishedService == nil && !peripheralManager.isAdvertising && !advertisingPending {
      advertisingPending = true
      trace("starting advertising")
      peripheralManager.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [service]])
    }
    stateEvent()
  }
  func stop() {
    trace("stop requested")
    voice?.finish("bluetooth_stopped", failed: false)
    wanted = false; timer?.invalidate(); timer = nil
    centralManager.stopScan(); peripheralManager.stopAdvertising(); peripheralManager.removeAllServices(); serviceReady = false; publishedService = nil; advertisingPending = false
    for link in Array(outgoing.values) { if let p = link.peripheral { centralManager.cancelPeripheralConnection(p); p.delegate = nil }; drop(link, "STOPPED") }
    for link in Array(incoming.values) { drop(link, "STOPPED") }
    outgoing.removeAll(); incoming.removeAll(); retiring.removeAll(); cooldown.removeAll(); notifyChar = nil; stateEvent()
  }
  private func drop(_ link: BeaconLink, _ code: String) {
    if voice?.peerId == link.id { voice?.finish("bluetooth_disconnected", failed: false) }
    for job in link.queue { job.promise.reject(code, "BLE session closed; retry durable queue") }
    link.queue.removeAll(); link.ready = false
    emit("onPeer", ["peerId": link.id, "state": "disconnected"])
  }
  private func close(_ link: BeaconLink, _ code: String, disconnected: Bool = false, cause: Error? = nil) {
    error(code, cause?.localizedDescription ?? "BLE session failed; reconnecting", link.id)
    if let p = link.peripheral {
      outgoing.removeValue(forKey: p.identifier); p.delegate = nil
      if !disconnected {
        retiring[p.identifier] = (p, ProcessInfo.processInfo.systemUptime)
        centralManager.cancelPeripheralConnection(p)
      }
      let attempt = min((cooldown[p.identifier]?.1 ?? 0) + 1, 5)
      cooldown[p.identifier] = (ProcessInfo.processInfo.systemUptime + pow(2, Double(attempt)), attempt)
    }
    if let c = link.central { incoming.removeValue(forKey: c.identifier) }
    drop(link, code)
  }
  private func tick() {
    // Do not reuse a CBPeripheral until cancellation completes. If CoreBluetooth
    // never completes it, retire the manager so its callbacks cannot hit a retry.
    if retiring.values.contains(where: { ProcessInfo.processInfo.systemUptime - $0.1 > 20 }) {
      centralManager.delegate = nil; centralManager.stopScan()
      for link in Array(outgoing.values) {
        if let p = link.peripheral { p.delegate = nil; centralManager.cancelPeripheralConnection(p) }
        drop(link, "RADIO_RESTART")
      }
      outgoing.removeAll(); retiring.removeAll()
      centralManager = CBCentralManager(delegate: self, queue: .main)
    }
    for link in Array(outgoing.values) + Array(incoming.values) {
      link.rx.expire()
      if (!link.ready && ProcessInfo.processInfo.systemUptime - link.created > 20) || (link.queue.first.map { ProcessInfo.processInfo.systemUptime - $0.started > 90 } ?? false) { close(link, "TIMEOUT") }
    }
    if cooldown.count > 64 { cooldown = cooldown.filter { $0.value.0 > ProcessInfo.processInfo.systemUptime } }
    activate()
  }
  func send(peer: String, base64: String, promise: Promise) {
    guard base64.utf8.count <= 21_848, let data = Data(base64Encoded: base64), !data.isEmpty, data.count <= BeaconFrame.maxBytes else { promise.reject("INVALID_DATA", "Expected 1–16384 bytes of base64 data"); return }
    guard let link = (Array(outgoing.values) + Array(incoming.values)).first(where: { $0.id == peer && $0.ready }) else { promise.reject("NOT_CONNECTED", "Peer is not connected"); return }
    guard link.queue.count < 8 else { promise.reject("QUEUE_FULL", "Peer send queue is full"); return }
    let limit = link.peripheral?.maximumWriteValueLength(for: .withResponse) ?? link.central?.maximumUpdateValueLength ?? 20
    trace("queue message bytes=\(data.count) role=\(link.peripheral == nil ? "peripheral" : "central")")
    do { sequence &+= 1; link.queue.append(BeaconSend(try BeaconFrame.encode(data, id: sequence, limit: limit), promise)); pump(link) }
    catch { promise.reject("FRAME_ERROR", "Could not frame message") }
  }
  private func pump(_ link: BeaconLink) {
    guard link.ready, !link.pending, let job = link.queue.first else { return }
    if let p = link.peripheral, let w = link.write {
      link.pending = true; p.writeValue(job.frames[job.index], for: w, type: .withResponse)
    } else if let c = link.central, let n = notifyChar {
      // CoreBluetooth exposes queue acceptance, not a per-notification delivery callback.
      while job.index < job.frames.count {
        guard peripheralManager.updateValue(job.frames[job.index], for: n, onSubscribedCentrals: [c]) else { return }
        job.index += 1
      }
      job.promise.resolve(nil); link.queue.removeFirst(); pump(link)
    }
  }
  private func receive(_ data: Data, link: BeaconLink) -> Bool {
    do { if let complete = try link.rx.accept(data) { trace("received complete message bytes=\(complete.count)"); emit("onData", ["peerId": link.id, "base64": complete.base64EncodedString()]) }; return true }
    catch { self.error("INVALID_FRAME", "Malformed or excessive BLE frame", link.id); return false }
  }
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard central === centralManager else { return }
    trace("central state=\(central.state.rawValue)")
    if central.state != .poweredOn {
      voiceOpenPending = nil
      for link in outgoing.values { drop(link, "RADIO_UNAVAILABLE") }; outgoing.removeAll(); retiring.removeAll()
    }; activate(); stateEvent()
  }
  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    guard peripheral === peripheralManager else { return }
    trace("peripheral state=\(peripheral.state.rawValue)")
    if peripheral.state != .poweredOn {
      voicePublishPromise?.reject("BLUETOOTH_UNAVAILABLE", "Bluetooth became unavailable")
      voicePublishPromise = nil; voicePublishPending = nil
      serviceReady = false; publishedService = nil; advertisingPending = false; for link in incoming.values { drop(link, "RADIO_UNAVAILABLE") }; incoming.removeAll()
    }
    activate(); stateEvent()
  }
  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    guard central === centralManager, wanted, outgoing[peripheral.identifier] == nil, retiring[peripheral.identifier] == nil, outgoing.count < 4, (cooldown[peripheral.identifier]?.0 ?? 0) <= ProcessInfo.processInfo.systemUptime else { return }
    trace("discovered matching peer rssi=\(RSSI.intValue)")
    let link = BeaconLink("c:\(peripheral.identifier.uuidString):\(UUID().uuidString)"); link.peripheral = peripheral; outgoing[peripheral.identifier] = link
    emit("onPeer", ["peerId": link.id, "state": "discovered", "rssi": RSSI.intValue]); peripheral.delegate = self; central.connect(peripheral)
  }
  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) { guard central === centralManager, wanted, outgoing[peripheral.identifier]?.peripheral === peripheral else { central.cancelPeripheralConnection(peripheral); return }; trace("connected; discovering service"); peripheral.discoverServices([service]) }
  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    guard central === centralManager, wanted else { return }
    if retiring[peripheral.identifier]?.0 === peripheral { retiring.removeValue(forKey: peripheral.identifier); return }
    if let link = outgoing[peripheral.identifier], link.peripheral === peripheral { close(link, "CONNECT_FAILED", disconnected: true, cause: error) }
  }
  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    guard central === centralManager, wanted else { return }
    if voiceOpenPending?.expectedPeer === peripheral { voiceOpenPending = nil }
    if retiring[peripheral.identifier]?.0 === peripheral { retiring.removeValue(forKey: peripheral.identifier); return }
    if let link = outgoing[peripheral.identifier], link.peripheral === peripheral { close(link, "DISCONNECTED", disconnected: true, cause: error) }
  }
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard wanted, let link = outgoing[peripheral.identifier], link.peripheral === peripheral else { return }
    guard error == nil, let s = peripheral.services?.first(where: { $0.uuid == service }) else { close(link, "SERVICE_MISSING", cause: error); return }
    trace("service discovered; discovering characteristics")
    peripheral.discoverCharacteristics([writeId, notifyId], for: s)
  }
  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard wanted, let link = outgoing[peripheral.identifier], link.peripheral === peripheral else { return }
    link.write = service.characteristics?.first { $0.uuid == writeId }; link.notify = service.characteristics?.first { $0.uuid == notifyId }
    guard error == nil, link.write?.properties.contains(.write) == true, let n = link.notify, n.properties.contains(.notify) else { close(link, "CHARACTERISTICS_MISSING", cause: error); return }
    trace("characteristics discovered; enabling notifications")
    peripheral.setNotifyValue(true, for: n)
  }
  func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    guard wanted, let link = outgoing[peripheral.identifier], link.peripheral === peripheral else { return }
    guard characteristic === link.notify else { trace("ignored subscription callback: characteristic identity mismatch, uuid=\(characteristic.uuid)"); return }
    guard error == nil, characteristic.isNotifying else { close(link, "SUBSCRIBE_FAILED", cause: error); return }
    trace("central session ready")
    link.ready = true; cooldown.removeValue(forKey: peripheral.identifier)
    emit("onPeer", ["peerId": link.id, "state": "connected", "mtu": peripheral.maximumWriteValueLength(for: .withResponse) + 3])
  }
  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    guard wanted, let link = outgoing[peripheral.identifier], link.peripheral === peripheral, characteristic === link.write, link.pending, let job = link.queue.first else { return }
    if error != nil { close(link, "WRITE_FAILED", cause: error); return }
    link.pending = false; job.index += 1
    if job.index == job.frames.count { job.promise.resolve(nil); link.queue.removeFirst() }; pump(link)
  }
  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard wanted, let link = outgoing[peripheral.identifier], link.peripheral === peripheral, characteristic.uuid == notifyId else { return }
    guard error == nil, let data = characteristic.value else { close(link, "READ_FAILED", cause: error); return }; _ = receive(data, link: link)
  }
  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    guard peripheral === peripheralManager, wanted else { return }
    trace("service publication callback sameObject=\(publishedService === service) error=\(error?.localizedDescription ?? "none")")
    guard publishedService === service else { return }
    publishedService = nil
    guard error == nil else { serviceReady = false; self.error("SERVICE_FAILED", error?.localizedDescription ?? "Cannot publish BLE service"); return }
    activate()
  }
  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) { guard peripheral === peripheralManager, wanted else { peripheral.stopAdvertising(); return }; advertisingPending = false; trace("advertising callback active=\(peripheral.isAdvertising) error=\(error?.localizedDescription ?? "none")"); if error != nil { self.error("ADVERTISE_FAILED", error?.localizedDescription ?? "Cannot advertise BLE service") }; stateEvent() }
  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
    guard peripheral === peripheralManager, wanted else { return }
    trace("peripheral subscription callback sameObject=\(characteristic === notifyChar) uuid=\(characteristic.uuid)")
    guard characteristic === notifyChar, incoming.count < 4 || incoming[central.identifier] != nil else { return }
    let link = BeaconLink("p:\(central.identifier.uuidString):\(UUID().uuidString)"); link.central = central; link.ready = true
    if let old = incoming.updateValue(link, forKey: central.identifier) { drop(old, "REPLACED") }
    emit("onPeer", ["peerId": link.id, "state": "connected", "mtu": central.maximumUpdateValueLength + 3])
  }
  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) { guard peripheral === peripheralManager, wanted, characteristic === notifyChar else { return }; if let link = incoming.removeValue(forKey: central.identifier) { drop(link, "DISCONNECTED") } }
  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    guard peripheral === peripheralManager, let first = requests.first else { return }
    // CoreBluetooth requires one response for the entire delivered request batch.
    var result = CBATTError.Code.success
    for request in requests {
      guard wanted, request.characteristic.uuid == writeId, request.characteristic.service?.uuid == service, request.offset == 0, let data = request.value, let link = incoming[request.central.identifier] else { result = .writeNotPermitted; break }
      if !receive(data, link: link) { result = .invalidAttributeValueLength; break }
    }
    if result != .success { trace("reject write batch ATT=\(result.rawValue) subscribed=\(incoming[first.central.identifier] != nil) service=\(first.characteristic.service?.uuid.uuidString ?? "nil")") }
    peripheral.respond(to: first, withResult: result)
  }
  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) { guard peripheral === peripheralManager, wanted else { return }; for link in incoming.values { pump(link) } }

  static func voiceSupport() -> [String: Any] {
#if targetEnvironment(simulator)
    return ["supported": false, "reason": "Bluetooth calling requires a physical iPhone"]
#else
    return ["supported": true]
#endif
  }

  func voicePrepare(_ options: [String: Any], promise: Promise) {
    guard Self.voiceSupport()["supported"] as? Bool == true else { promise.reject("VOICE_UNSUPPORTED", "Bluetooth calling requires a physical iPhone"); return }
    guard wanted, centralManager.state == .poweredOn, peripheralManager.state == .poweredOn,
      UIApplication.shared.applicationState == .active else { promise.reject("VOICE_UNAVAILABLE", "Bluetooth and foreground access are required"); return }
    guard voice == nil else { promise.reject("VOICE_BUSY", "A call is already in progress"); return }
    guard voicePublishPending == nil, voiceOpenPending == nil else { promise.reject("VOICE_BUSY", "Bluetooth is still closing the last call. Restart Nearby in Settings if this continues."); return }
    guard let callId = options["callId"] as? String, let peerId = options["peerId"] as? String,
      let encoded = options["keyBase64"] as? String, encoded.count == 44,
      let key = Data(base64Encoded: encoded), key.count == 32, key.base64EncodedString() == encoded,
      let initiator = options["initiator"] as? Bool,
      let link = (Array(outgoing.values) + Array(incoming.values)).first(where: { $0.id == peerId && $0.ready }),
      let peer: CBPeer = initiator ? link.peripheral : link.central else {
      promise.reject("INVALID_VOICE_PEER", "A connected peer with the requested Bluetooth role and a 32-byte call key is required"); return
    }
    do {
      let session = try BeaconVoiceSession(callId: callId, peerId: peerId, peer: peer, key: key, initiator: initiator,
        emit: { [weak self] body in self?.emit("onVoice", body) }, onEnd: { [weak self] ended in self?.voiceEnded(ended) })
      voice = session
      if initiator { promise.resolve(["psm": 0]) }
      else {
        voicePublishPending = callId; voicePublishPromise = promise
        // Application-layer authenticated encryption avoids pairing UI; the
        // negotiated secret is carried only by the authenticated JS signaling.
        peripheralManager.publishL2CAPChannel(withEncryption: false)
      }
    } catch { promise.reject("INVALID_VOICE_CALL", "Invalid call identifier or key") }
  }

  func voiceConnect(_ options: [String: Any], promise: Promise) {
    guard let session = voice, !session.closed, session.initiator,
      options["callId"] as? String == session.callId, options["peerId"] as? String == session.peerId,
      let psm = options["psm"] as? Int, psm > 0, psm <= Int(UInt16.max),
      session.psm == 0, voiceOpenPending == nil,
      let peripheral = session.expectedPeer as? CBPeripheral,
      let link = outgoing[peripheral.identifier], link.ready, link.id == session.peerId, link.peripheral === peripheral else {
      promise.reject("INVALID_VOICE_CHANNEL", "Call and connected central link must match"); return
    }
    session.psm = CBL2CAPPSM(psm); voiceOpenPending = session
    peripheral.openL2CAPChannel(session.psm)
    promise.resolve(nil)
  }

  func voiceStart(_ callId: String, promise: Promise) {
    guard let session = voice, session.callId == callId else { promise.reject("VOICE_NOT_READY", "No matching call"); return }
    session.start(promise)
  }
  func voiceStop(_ callId: String) { if voice?.callId == callId { voice?.finish("local_ended", failed: false) } }
  func voiceSetMuted(_ value: Bool) { voice?.setMuted(value) }
  func voiceSetSpeaker(_ value: Bool) throws { try voice?.setSpeaker(value) }

  private func voiceEnded(_ session: BeaconVoiceSession) {
    guard voice === session else { return }
    if !session.initiator, session.psm != 0 { peripheralManager.unpublishL2CAPChannel(session.psm) }
    if voicePublishPending == session.callId {
      voicePublishPromise?.reject("VOICE_ENDED", "Call ended before channel publication")
      voicePublishPromise = nil
      // Leave the operation marker until its callback, so a late publish cannot
      // be mistaken for a subsequent call. stop/start retires the manager too.
    }
    voice = nil
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didPublishL2CAPChannel PSM: CBL2CAPPSM, error: Error?) {
    guard peripheral === peripheralManager else { return }
    let callId = voicePublishPending; let promise = voicePublishPromise
    voicePublishPending = nil; voicePublishPromise = nil
    guard wanted, let session = voice, session.callId == callId, !session.initiator, !session.closed else {
      if error == nil, PSM != 0 { peripheral.unpublishL2CAPChannel(PSM) }
      promise?.reject("VOICE_ENDED", "Call ended before channel publication"); return
    }
    guard error == nil, PSM != 0 else {
      promise?.reject("VOICE_PUBLISH_FAILED", "Could not publish Bluetooth audio channel")
      session.finish("channel_publish_failed", failed: true); return
    }
    session.psm = PSM; promise?.resolve(["psm": Int(PSM)])
  }

  func peripheral(_ peripheral: CBPeripheral, didOpen channel: CBL2CAPChannel?, error: Error?) {
    guard let pending = voiceOpenPending, pending.expectedPeer === peripheral else {
      channel?.inputStream.close(); channel?.outputStream.close(); return
    }
    voiceOpenPending = nil
    guard wanted, voice === pending, !pending.closed,
      outgoing[peripheral.identifier]?.peripheral === peripheral else {
      channel?.inputStream.close(); channel?.outputStream.close(); return
    }
    guard error == nil, let channel, channel.peer.identifier == peripheral.identifier, channel.psm == pending.psm else {
      channel?.inputStream.close(); channel?.outputStream.close()
      pending.finish("channel_open_failed", failed: true); return
    }
    pending.attach(channel)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didOpen channel: CBL2CAPChannel?, error: Error?) {
    guard peripheral === peripheralManager, wanted, let session = voice, !session.initiator, !session.closed,
      let channel, error == nil, channel.psm == session.psm,
      channel.peer.identifier == session.expectedPeer.identifier,
      let central = session.expectedPeer as? CBCentral,
      let link = incoming[central.identifier], link.ready, link.id == session.peerId, link.central === central else {
      channel?.inputStream.close(); channel?.outputStream.close(); return
    }
    session.attach(channel)
  }
}
