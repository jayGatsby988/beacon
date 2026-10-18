@file:Suppress("DEPRECATION", "MissingPermission")
package expo.modules.beaconble

import android.Manifest
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.*
import android.content.pm.PackageManager
import android.os.*
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID
import java.util.ArrayDeque

class BeaconBleModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private var transport: BeaconTransport? = null
  override fun definition() = ModuleDefinition {
    Name("BeaconBle")
    Events("onPeer", "onData", "onState", "onError")
    AsyncFunction("start") { options: Map<String, String>, promise: Promise -> handler.post {
      val context = appContext.reactContext
      if (context == null) promise.reject("NO_CONTEXT", "React context unavailable", null)
      else if (options["nodeId"].isNullOrBlank()) promise.reject("INVALID_ID", "A nodeId is required", null)
      else {
        if (transport == null) transport = BeaconTransport(context, handler) { event, body -> sendEvent(event, body) }
        transport!!.start(options["serviceUuid"], promise)
      }
    }; Unit }
    AsyncFunction("stop") { promise: Promise -> handler.post { transport?.stop(); promise.resolve(null) }; Unit }
    AsyncFunction("getState") { promise: Promise -> handler.post { promise.resolve(transport?.state() ?: mapOf("state" to "unknown", "advertising" to false, "scanning" to false)) }; Unit }
    AsyncFunction("send") { peerId: String, base64: String, promise: Promise -> handler.post {
      val t = transport
      if (t == null) promise.reject("NOT_STARTED", "Start Bluetooth first", null) else t.send(peerId, base64, promise)
    }; Unit }
    OnDestroy { handler.post { transport?.stop(); transport = null } }
  }
}

private class Send(val frames: List<ByteArray>, val promise: Promise) {
  var index = 0; val started = SystemClock.elapsedRealtime()
}
private class Link(val device: BluetoothDevice, val incoming: Boolean) {
  val id = (if (incoming) "p:" else "c:") + UUID.randomUUID().toString()
  var gatt: BluetoothGatt? = null; var write: BluetoothGattCharacteristic? = null
  var ready = false; var mtu = 23; var pending = false; val created = SystemClock.elapsedRealtime()
  val queue = ArrayDeque<Send>(); val rx = BeaconReassembler()
}
private class BeaconTransport(private val context: Context, private val h: Handler, private val emit: (String, Map<String, Any>) -> Unit) {
  private val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
  private val adapter get() = manager.adapter
  private var wanted = false; private var scanning = false; private var advertising = false; private var publishing = false
  private var generation = 0L
  private var publicationStarted = 0L
  private var serviceReady = false; private var pendingService: BluetoothGattService? = null
  private var scan: ScanCallback? = null; private var advertise: AdvertiseCallback? = null
  private var cleaning = false
  private var registered = false; private var server: BluetoothGattServer? = null
  private var notifyChar: BluetoothGattCharacteristic? = null; private var serverPending: Link? = null
  private var serviceId = UUID.fromString("7C51A100-1B15-4F0D-9B8D-0E4B8D638010")
  private val writeId = UUID.fromString("7C51A101-1B15-4F0D-9B8D-0E4B8D638010")
  private val notifyId = UUID.fromString("7C51A102-1B15-4F0D-9B8D-0E4B8D638010")
  private val cccId = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
  private val outgoing = mutableMapOf<String, Link>(); private val incoming = mutableMapOf<String, Link>()
  private val cooldown = mutableMapOf<String, Pair<Long, Int>>()
  private var sequence = java.security.SecureRandom().nextInt()
  private fun authorized(): Boolean {
    val permissions = if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE) else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    return permissions.all { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
  }
  fun state(): Map<String, Any> {
    val status = if (adapter == null || !context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) "unsupported" else if (!authorized()) "unauthorized" else if (adapter.isEnabled) "poweredOn" else "poweredOff"
    return mapOf("state" to status, "scanning" to scanning, "advertising" to advertising)
  }
  private fun stateEvent() { emit("onState", state()) }
  private fun error(code: String, message: String, peer: String? = null) {
    val body = mutableMapOf<String, Any>("code" to code, "message" to message); if (peer != null) body["peerId"] = peer; emit("onError", body)
  }
  private val radio = object : BroadcastReceiver() { override fun onReceive(c: Context?, intent: Intent?) { h.post {
    if (intent?.action == BluetoothAdapter.ACTION_STATE_CHANGED) {
      if (adapter?.isEnabled != true) cleanup() else activate(); stateEvent()
    }
  } } }
  fun start(value: String?, promise: Promise) {
    val requested = if (value == null) serviceId else try { UUID.fromString(value) } catch (e: IllegalArgumentException) { promise.reject("INVALID_UUID", "Invalid service UUID", e); return }
    if (wanted) { promise.resolve(state()); return }
    serviceId = requested
    if (!authorized()) { stateEvent(); promise.reject("UNAUTHORIZED", "Grant Bluetooth permissions before starting", null); return }
    if (adapter == null) { stateEvent(); promise.reject("UNSUPPORTED", "Bluetooth LE is unavailable", null); return }
    if (!wanted) {
      wanted = true
      if (!registered) {
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(radio, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), Context.RECEIVER_EXPORTED)
        else context.registerReceiver(radio, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED))
        registered = true
      }
      h.post(tick)
    }
    activate(); promise.resolve(state())
  }
  private fun activate() {
    if (!wanted || !authorized() || adapter?.isEnabled != true) return
    try {
      if (server == null) {
        server = manager.openGattServer(context, serverCallback(generation))
        if (server == null) { error("SERVER_FAILED", "GATT server is unavailable"); return }
      }
      if (!serviceReady && pendingService == null) {
        val service = BluetoothGattService(serviceId, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        service.addCharacteristic(BluetoothGattCharacteristic(writeId, BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE))
        val n = BluetoothGattCharacteristic(notifyId, BluetoothGattCharacteristic.PROPERTY_NOTIFY, 0)
        n.addDescriptor(BluetoothGattDescriptor(cccId, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
        service.addCharacteristic(n); notifyChar = n; pendingService = service; publicationStarted = SystemClock.elapsedRealtime()
        if (server?.addService(service) != true) { pendingService = null; error("SERVICE_FAILED", "Could not add GATT service") }
      }
      if (serviceReady && !advertising && !publishing) {
        val advertiser = adapter.bluetoothLeAdvertiser
        if (advertiser == null) error("ADVERTISE_UNSUPPORTED", "This phone cannot advertise BLE; it can still discover peers")
        else {
          val callback = advertiseCallback(generation); advertise = callback; publishing = true; publicationStarted = SystemClock.elapsedRealtime()
          try { advertiser.startAdvertising(AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY).setConnectable(true).setTimeout(0).build(), AdvertiseData.Builder().addServiceUuid(ParcelUuid(serviceId)).setIncludeDeviceName(false).build(), callback) }
          catch (e: Exception) { publishing = false; error("ADVERTISE_FAILED", e.message ?: "Advertising failed") }
        }
      }
      if (!scanning) {
        val scanner = adapter.bluetoothLeScanner
        if (scanner == null) error("SCAN_UNAVAILABLE", "Bluetooth scanner unavailable")
        else { val callback = scanCallback(generation); scan = callback; scanner.startScan(listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(serviceId)).build()), ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), callback); scanning = true }
      }
    } catch (e: Exception) { pendingService = null; publishing = false; error("START_FAILED", e.message ?: "Bluetooth start failed") }
    stateEvent()
  }
  private val tick = object : Runnable { override fun run() {
    if (!wanted) return
    val now = SystemClock.elapsedRealtime()
    if ((pendingService != null || publishing) && now - publicationStarted > 20_000) {
      error("PUBLICATION_TIMEOUT", "BLE publication timed out; restarting transport"); cleanup()
    }
    for (link in outgoing.values.toList() + incoming.values.toList()) {
      link.rx.expire()
      if ((!link.ready && now - link.created > 20_000) || (link.queue.peek()?.let { now - it.started > 90_000 } == true)) close(link, "TIMEOUT")
    }
    if (cooldown.size > 64) cooldown.entries.removeAll { it.value.first < now }
    activate(); h.postDelayed(this, 2000)
  } }
  fun stop() {
    wanted = false; h.removeCallbacks(tick); cleanup(); cooldown.clear()
    if (registered) { context.unregisterReceiver(radio); registered = false }; stateEvent()
  }
  private fun cleanup() {
    cleaning = true; generation++
    try { scan?.let { adapter?.bluetoothLeScanner?.stopScan(it) }; advertise?.let { adapter?.bluetoothLeAdvertiser?.stopAdvertising(it) } } catch (_: Exception) { }
    for (link in outgoing.values.toList() + incoming.values.toList()) close(link, "STOPPED", false)
    outgoing.clear(); incoming.clear(); serverPending = null
    try { server?.close() } catch (_: Exception) { }; server = null; notifyChar = null
    scanning = false; advertising = false; publishing = false; serviceReady = false; pendingService = null; scan = null; advertise = null; cleaning = false
  }
  private fun close(link: Link, code: String, retry: Boolean = true) {
    if ((if (link.incoming) incoming[link.device.address] else outgoing[link.device.address]) !== link) return
    // Android notification completions identify only a device, not a session. Retire
    // the callback generation if an in-flight notification loses its session.
    if (!cleaning && serverPending === link) { cleanup(); return }
    if (link.incoming) incoming.remove(link.device.address) else outgoing.remove(link.device.address)
    if (serverPending === link) serverPending = null
    if (!link.incoming && retry) {
      val attempts = minOf((cooldown[link.device.address]?.second ?: 0) + 1, 5)
      cooldown[link.device.address] = Pair(SystemClock.elapsedRealtime() + (1L shl attempts) * 1000L, attempts)
    }
    try { link.gatt?.disconnect(); link.gatt?.close(); if (link.incoming) server?.cancelConnection(link.device) } catch (_: Exception) { }
    while (link.queue.isNotEmpty()) link.queue.remove().promise.reject(code, "BLE session closed; retry durable queue", null)
    link.ready = false; emit("onPeer", mapOf("peerId" to link.id, "state" to "disconnected"))
    if (code != "STOPPED" && code != "DISCONNECTED") error(code, "BLE session failed", link.id)
    if (retry) pumpServer()
  }
  fun send(peerId: String, base64: String, promise: Promise) {
    val data = try { require(base64.length <= 21848); Base64.decode(base64, Base64.NO_WRAP) } catch (e: Exception) { promise.reject("INVALID_DATA", "Invalid or oversized base64", e); return }
    if (data.isEmpty() || data.size > BeaconFrame.MAX_BYTES) { promise.reject("INVALID_DATA", "Expected 1–16384 bytes", null); return }
    val link = (outgoing.values + incoming.values).firstOrNull { it.id == peerId && it.ready }
    if (link == null) { promise.reject("NOT_CONNECTED", "Peer is not connected", null); return }
    if (link.queue.size >= 8) { promise.reject("QUEUE_FULL", "Peer send queue is full", null); return }
    link.queue.add(Send(BeaconFrame.encode(data, sequence++, link.mtu - 3), promise))
    if (link.incoming) pumpServer() else pump(link)
  }
  private fun finish(link: Link) {
    val job = link.queue.peek() ?: return; job.index++; link.pending = false
    if (job.index == job.frames.size) { link.queue.remove(); job.promise.resolve(null) }
  }
  private fun pump(link: Link) {
    if (!link.ready || link.pending) return
    val job = link.queue.peek() ?: return; val gatt = link.gatt ?: return; val w = link.write ?: return
    try {
      link.pending = true
      val data = job.frames[job.index]
      val ok = if (Build.VERSION.SDK_INT >= 33) gatt.writeCharacteristic(w, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS else { w.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT; w.value = data; gatt.writeCharacteristic(w) }
      if (!ok) close(link, "WRITE_FAILED")
    } catch (e: Exception) { close(link, "WRITE_FAILED") }
  }
  private fun pumpServer() {
    if (serverPending != null) return
    val link = incoming.values.firstOrNull { it.ready && it.queue.isNotEmpty() } ?: return
    val job = link.queue.peek() ?: return; val characteristic = notifyChar ?: return
    try {
      serverPending = link
      val data = job.frames[job.index]
      val ok = if (Build.VERSION.SDK_INT >= 33) server?.notifyCharacteristicChanged(link.device, characteristic, false, data) == BluetoothStatusCodes.SUCCESS else { characteristic.value = data; server?.notifyCharacteristicChanged(link.device, characteristic, false) == true }
      if (!ok) close(link, "NOTIFY_FAILED")
    } catch (e: Exception) { close(link, "NOTIFY_FAILED") }
  }
  private fun receive(link: Link, data: ByteArray): Boolean = try {
    link.rx.accept(data)?.let { emit("onData", mapOf("peerId" to link.id, "base64" to Base64.encodeToString(it, Base64.NO_WRAP))) }; true
  } catch (e: Exception) { error("INVALID_FRAME", "Malformed or excessive BLE frame", link.id); false }
  private fun scanCallback(epoch: Long) = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) { h.post {
      if (!wanted || epoch != generation || scan !== this) return@post
      val device = result.device; val address = device.address
      if (!wanted || outgoing.size >= 4 || outgoing.containsKey(address) || (cooldown[address]?.first ?: 0) > SystemClock.elapsedRealtime()) return@post
      val link = Link(device, false); outgoing[address] = link
      emit("onPeer", mapOf("peerId" to link.id, "state" to "discovered", "rssi" to result.rssi))
      try { link.gatt = device.connectGatt(context, false, clientCallback, BluetoothDevice.TRANSPORT_LE); if (link.gatt == null) close(link, "CONNECT_FAILED") } catch (_: Exception) { close(link, "CONNECT_FAILED") }
    } }
    override fun onScanFailed(errorCode: Int) { h.post { if (!wanted || epoch != generation || scan !== this) return@post; scanning = false; error("SCAN_FAILED", "Android scan error $errorCode"); stateEvent() } }
  }
  private fun advertiseCallback(epoch: Long) = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings) { h.post { if (!wanted || epoch != generation || advertise !== this) return@post; advertising = true; publishing = false; stateEvent() } }
    override fun onStartFailure(errorCode: Int) { h.post { if (!wanted || epoch != generation || advertise !== this) return@post; advertising = false; publishing = false; error("ADVERTISE_FAILED", "Android advertising error $errorCode"); stateEvent() } }
  }
  private val clientCallback = object : BluetoothGattCallback() {
    private fun current(g: BluetoothGatt) = outgoing[g.device.address]?.takeIf { wanted && it.gatt === g }
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) { h.post {
      val link = current(g) ?: return@post
      if (status != BluetoothGatt.GATT_SUCCESS || newState == BluetoothProfile.STATE_DISCONNECTED) { close(link, "DISCONNECTED"); return@post }
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        // All setup operations are serialized by callbacks, including MTU negotiation.
        if (!g.requestMtu(185) && !g.discoverServices()) close(link, "DISCOVERY_FAILED")
      }
    } }
    override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) { h.post {
      val link = current(g) ?: return@post
      if (status == BluetoothGatt.GATT_SUCCESS) link.mtu = mtu.coerceIn(23, 517)
      if (!link.ready && !g.discoverServices()) close(link, "DISCOVERY_FAILED")
    } }
    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) { h.post {
      val link = current(g) ?: return@post
      val service = g.getService(serviceId); val w = service?.getCharacteristic(writeId); val n = service?.getCharacteristic(notifyId); val d = n?.getDescriptor(cccId)
      if (status != BluetoothGatt.GATT_SUCCESS || w == null || n == null || d == null || w.properties and BluetoothGattCharacteristic.PROPERTY_WRITE == 0 || n.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY == 0) { close(link, "SERVICE_MISSING"); return@post }
      link.write = w
      if (!g.setCharacteristicNotification(n, true)) { close(link, "SUBSCRIBE_FAILED"); return@post }
      val ok = if (Build.VERSION.SDK_INT >= 33) g.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothStatusCodes.SUCCESS else { d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE; g.writeDescriptor(d) }
      if (!ok) close(link, "SUBSCRIBE_FAILED")
    } }
    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) { h.post {
      val link = current(g) ?: return@post
      if (descriptor.uuid != cccId || descriptor.characteristic.uuid != notifyId) return@post
      if (status != BluetoothGatt.GATT_SUCCESS) { close(link, "SUBSCRIBE_FAILED"); return@post }
      link.ready = true; cooldown.remove(g.device.address)
      emit("onPeer", mapOf("peerId" to link.id, "state" to "connected", "mtu" to link.mtu))
    } }
    override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) { h.post {
      val link = current(g) ?: return@post
      if (!link.pending || characteristic.uuid != writeId) return@post
      if (status != BluetoothGatt.GATT_SUCCESS) { close(link, "WRITE_FAILED"); return@post }
      finish(link); pump(link)
    } }
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) { val copy = value.copyOf(); h.post { current(g)?.let { if (characteristic.uuid == notifyId) receive(it, copy) } } }
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) { if (Build.VERSION.SDK_INT < 33) onCharacteristicChanged(g, characteristic, characteristic.value ?: byteArrayOf()) }
  }
  private fun serverCallback(epoch: Long) = object : BluetoothGattServerCallback() {
    override fun onServiceAdded(status: Int, service: BluetoothGattService) { h.post {
      if (!wanted || epoch != generation || pendingService !== service) return@post
      pendingService = null
      if (status != BluetoothGatt.GATT_SUCCESS) { error("SERVICE_FAILED", "GATT service registration failed"); return@post }
      serviceReady = true; activate()
    } }
    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) { h.post {
      if (!wanted || epoch != generation) return@post
      if (newState == BluetoothProfile.STATE_DISCONNECTED) { incoming[device.address]?.let { close(it, "DISCONNECTED") } }
      else if (newState == BluetoothProfile.STATE_CONNECTED && wanted) {
        if (incoming.size >= 4 && !incoming.containsKey(device.address)) server?.cancelConnection(device)
        else if (!incoming.containsKey(device.address)) incoming[device.address] = Link(device, true)
      }
    } }
    override fun onMtuChanged(device: BluetoothDevice, mtu: Int) { h.post {
      if (!wanted || epoch != generation) return@post
      incoming[device.address]?.mtu = mtu.coerceIn(23, 517) } }
    override fun onDescriptorReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, descriptor: BluetoothGattDescriptor) { h.post {
      if (!wanted || epoch != generation) return@post
      val valid = descriptor.uuid == cccId && offset == 0
      server?.sendResponse(device, requestId, if (valid) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_INVALID_OFFSET, 0, if (incoming[device.address]?.ready == true) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE else BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE)
    } }
    override fun onDescriptorWriteRequest(device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray) { val copy = value.copyOf(); h.post {
      if (!wanted || epoch != generation) return@post
      val link = incoming[device.address]
      val enabled = copy.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
      val disabled = copy.contentEquals(BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE)
      val valid = wanted && link != null && descriptor.uuid == cccId && offset == 0 && !preparedWrite && (enabled || disabled)
      if (responseNeeded) server?.sendResponse(device, requestId, if (valid) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, 0, null)
      if (valid) {
        if (enabled && !link.ready) { link.ready = true; emit("onPeer", mapOf("peerId" to link.id, "state" to "connected", "mtu" to link.mtu)) }
        else if (disabled) close(link, "DISCONNECTED")
      }
    } }
    override fun onCharacteristicWriteRequest(device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray) { val copy = value.copyOf(); h.post {
      if (!wanted || epoch != generation) return@post
      val link = incoming[device.address]
      val valid = wanted && link?.ready == true && characteristic.uuid == writeId && !preparedWrite && offset == 0 && receive(link, copy)
      if (responseNeeded) server?.sendResponse(device, requestId, if (valid) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, 0, null)
    } }
    override fun onExecuteWrite(device: BluetoothDevice, requestId: Int, execute: Boolean) { h.post {
      if (!wanted || epoch != generation) return@post
      server?.sendResponse(device, requestId, BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, 0, null) } }
    override fun onNotificationSent(device: BluetoothDevice, status: Int) { h.post {
      if (!wanted || epoch != generation) return@post
      val link = serverPending?.takeIf { it.device.address == device.address } ?: return@post
      serverPending = null
      if (status != BluetoothGatt.GATT_SUCCESS) close(link, "NOTIFY_FAILED") else finish(link)
      pumpServer()
    } }
  }
}
