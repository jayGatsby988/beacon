import ExpoModulesCore
import CoreBluetooth

public class BeaconBleModule: Module {
  private var transport: BeaconTransport?
  public func definition() -> ModuleDefinition {
    Name("BeaconBle")
    Events("onPeer", "onData", "onState", "onError")
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
  private func error(_ code: String, _ message: String, _ peer: String? = nil) {
    var body: [String: Any] = ["code": code, "message": message]; if let peer { body["peerId"] = peer }; emit("onError", body)
  }
  func start(service value: String?, promise: Promise) {
    if let value, UUID(uuidString: value) == nil { promise.reject("INVALID_UUID", "Invalid service UUID"); return }
    if wanted { promise.resolve(state()); return }
    if let value { service = CBUUID(string: value) }
    // Fresh managers isolate queued callbacks from a prior stop/start lifecycle.
    centralManager.delegate = nil; peripheralManager.delegate = nil
    centralManager = CBCentralManager(delegate: self, queue: .main)
    peripheralManager = CBPeripheralManager(delegate: self, queue: .main)
    wanted = true
    timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.tick() }
    activate(); promise.resolve(state())
  }
  private func activate() {
    guard wanted else { return }
    if centralManager.state == .poweredOn && !centralManager.isScanning {
      centralManager.scanForPeripherals(withServices: [service], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    }
    if peripheralManager.state == .poweredOn && !serviceReady {
      serviceReady = true
      let s = CBMutableService(type: service, primary: true)
      let w = CBMutableCharacteristic(type: writeId, properties: [.write], value: nil, permissions: [.writeable])
      let n = CBMutableCharacteristic(type: notifyId, properties: [.notify], value: nil, permissions: [])
      notifyChar = n; s.characteristics = [w, n]; publishedService = s; peripheralManager.add(s)
    }
    if peripheralManager.state == .poweredOn && serviceReady && publishedService == nil && !peripheralManager.isAdvertising && !advertisingPending {
      advertisingPending = true
      peripheralManager.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [service]])
    }
    stateEvent()
  }
  func stop() {
    wanted = false; timer?.invalidate(); timer = nil
    centralManager.stopScan(); peripheralManager.stopAdvertising(); peripheralManager.removeAllServices(); serviceReady = false; publishedService = nil; advertisingPending = false
    for link in Array(outgoing.values) { if let p = link.peripheral { centralManager.cancelPeripheralConnection(p); p.delegate = nil }; drop(link, "STOPPED") }
    for link in Array(incoming.values) { drop(link, "STOPPED") }
    outgoing.removeAll(); incoming.removeAll(); retiring.removeAll(); cooldown.removeAll(); notifyChar = nil; stateEvent()
  }
  private func drop(_ link: BeaconLink, _ code: String) {
    for job in link.queue { job.promise.reject(code, "BLE session closed; retry durable queue") }
    link.queue.removeAll(); link.ready = false
    emit("onPeer", ["peerId": link.id, "state": "disconnected"])
  }
  private func close(_ link: BeaconLink, _ code: String, disconnected: Bool = false) {
    error(code, "BLE session failed", link.id)
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
    do { if let complete = try link.rx.accept(data) { emit("onData", ["peerId": link.id, "base64": complete.base64EncodedString()]) }; return true }
    catch { self.error("INVALID_FRAME", "Malformed or excessive BLE frame", link.id); return false }
  }
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard central === centralManager else { return }
    if central.state != .poweredOn {
      for link in outgoing.values { drop(link, "RADIO_UNAVAILABLE") }; outgoing.removeAll(); retiring.removeAll()
    }; activate(); stateEvent()
  }
  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    guard peripheral === peripheralManager else { return }
    if peripheral.state != .poweredOn { serviceReady = false; publishedService = nil; advertisingPending = false; for link in incoming.values { drop(link, "RADIO_UNAVAILABLE") }; incoming.removeAll() }
    activate(); stateEvent()
  }
  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    guard central === centralManager, wanted, outgoing[peripheral.identifier] == nil, retiring[peripheral.identifier] == nil, outgoing.count < 4, (cooldown[peripheral.identifier]?.0 ?? 0) <= ProcessInfo.processInfo.systemUptime else { return }
    let link = BeaconLink("c:\(peripheral.identifier.uuidString):\(UUID().uuidString)"); link.peripheral = peripheral; outgoing[peripheral.identifier] = link
    emit("onPeer", ["peerId": link.id, "state": "discovered", "rssi": RSSI.intValue]); peripheral.delegate = self; central.connect(peripheral)
  }
  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) { guard central === centralManager, wanted, outgoing[peripheral.identifier]?.peripheral === peripheral else { central.cancelPeripheralConnection(peripheral); return }; peripheral.discoverServices([service]) }
  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    guard central === centralManager, wanted else { return }
    if retiring[peripheral.identifier]?.0 === peripheral { retiring.removeValue(forKey: peripheral.identifier); return }
    if let link = outgoing[peripheral.identifier], link.peripheral === peripheral { close(link, "CONNECT_FAILED", disconnected: true) }
  }
  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    guard central === centralManager, wanted else { return }
    if retiring[peripheral.identifier]?.0 === peripheral { retiring.removeValue(forKey: peripheral.identifier); return }
    if let link = outgoing[peripheral.identifier], link.peripheral === peripheral { close(link, "DISCONNECTED", disconnected: true) }
  }
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard wanted, let link = outgoing[peripheral.identifier], link.peripheral === peripheral else { return }
    guard error == nil, let s = peripheral.services?.first(where: { $0.uuid == service }) else { close(link, "SERVICE_MISSING"); return }
    peripheral.discoverCharacteristics([writeId, notifyId], for: s)
  }
  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard wanted, let link = outgoing[peripheral.identifier], link.peripheral === peripheral else { return }
    link.write = service.characteristics?.first { $0.uuid == writeId }; link.notify = service.characteristics?.first { $0.uuid == notifyId }
    guard error == nil, link.write?.properties.contains(.write) == true, let n = link.notify, n.properties.contains(.notify) else { close(link, "CHARACTERISTICS_MISSING"); return }
    peripheral.setNotifyValue(true, for: n)
  }
  func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    guard wanted, let link = outgoing[peripheral.identifier], link.peripheral === peripheral else { return }
    guard characteristic === link.notify else { return }
    guard error == nil, characteristic.isNotifying else { close(link, "SUBSCRIBE_FAILED"); return }
    link.ready = true; cooldown.removeValue(forKey: peripheral.identifier)
    emit("onPeer", ["peerId": link.id, "state": "connected", "mtu": peripheral.maximumWriteValueLength(for: .withResponse) + 3])
  }
  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    guard wanted, let link = outgoing[peripheral.identifier], link.peripheral === peripheral, characteristic === link.write, link.pending, let job = link.queue.first else { return }
    if error != nil { close(link, "WRITE_FAILED"); return }
    link.pending = false; job.index += 1
    if job.index == job.frames.count { job.promise.resolve(nil); link.queue.removeFirst() }; pump(link)
  }
  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard wanted, let link = outgoing[peripheral.identifier], link.peripheral === peripheral, characteristic.uuid == notifyId else { return }
    guard error == nil, let data = characteristic.value else { close(link, "READ_FAILED"); return }; _ = receive(data, link: link)
  }
  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    guard peripheral === peripheralManager, wanted, publishedService === service else { return }
    publishedService = nil
    guard error == nil else { serviceReady = false; self.error("SERVICE_FAILED", "Cannot publish BLE service"); return }
    activate()
  }
  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) { guard peripheral === peripheralManager, wanted else { peripheral.stopAdvertising(); return }; advertisingPending = false; if error != nil { self.error("ADVERTISE_FAILED", "Cannot advertise BLE service") }; stateEvent() }
  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
    guard peripheral === peripheralManager, wanted, characteristic === notifyChar, incoming.count < 4 || incoming[central.identifier] != nil else { return }
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
    peripheral.respond(to: first, withResult: result)
  }
  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) { guard peripheral === peripheralManager, wanted else { return }; for link in incoming.values { pump(link) } }
}
