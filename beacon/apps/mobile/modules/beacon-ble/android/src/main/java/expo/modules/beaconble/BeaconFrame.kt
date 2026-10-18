package expo.modules.beaconble

import java.io.ByteArrayOutputStream

internal object BeaconFrame {
  const val MAX_BYTES = 16384
  fun encode(data: ByteArray, id: Int, limit: Int): List<ByteArray> {
    require(data.isNotEmpty() && data.size <= MAX_BYTES && limit > 12)
    val size = minOf(limit, 512) - 12
    val count = (data.size + size - 1) / size
    return (0 until count).map { index ->
      byteArrayOf(0xB7.toByte(), 1, (id ushr 24).toByte(), (id ushr 16).toByte(), (id ushr 8).toByte(), id.toByte(), (index ushr 8).toByte(), index.toByte(), (count ushr 8).toByte(), count.toByte(), (data.size ushr 8).toByte(), data.size.toByte()) + data.copyOfRange(index * size, minOf((index + 1) * size, data.size))
    }
  }
}
internal class BeaconReassembler(private val clock: () -> Long = System::nanoTime) {
  private data class Partial(val count: Int, val total: Int, val created: Long, var next: Int = 0, val data: ByteArrayOutputStream = ByteArrayOutputStream())
  private val partials = mutableMapOf<Int, Partial>()
  fun expire(now: Long = clock()) { partials.entries.removeAll { now - it.value.created >= 90_000_000_000L } }
  fun accept(frame: ByteArray): ByteArray? {
    expire()
    require(frame.size in 13..512 && frame[0] == 0xB7.toByte() && frame[1] == 1.toByte())
    fun byte(i: Int) = frame[i].toInt() and 255
    val id = (byte(2) shl 24) or (byte(3) shl 16) or (byte(4) shl 8) or byte(5)
    val index = byte(6) * 256 + byte(7); val count = byte(8) * 256 + byte(9); val total = byte(10) * 256 + byte(11)
    require(total in 1..BeaconFrame.MAX_BYTES && count in 1..total && index < count)
    if (!partials.containsKey(id)) {
      require(index == 0 && partials.size < 2)
      partials[id] = Partial(count, total, clock())
    }
    val p = partials.getValue(id)
    if (p.next != index || p.count != count || p.total != total || p.data.size() + frame.size - 12 > total) {
      partials.remove(id); throw IllegalArgumentException("Invalid fragment sequence")
    }
    p.data.write(frame, 12, frame.size - 12); p.next++
    if (p.next == count) {
      partials.remove(id); require(p.data.size() == total); return p.data.toByteArray()
    }
    return null
  }
}
