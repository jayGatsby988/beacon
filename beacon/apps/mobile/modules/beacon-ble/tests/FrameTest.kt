package expo.modules.beaconble

fun main() {
  fun reject(body: () -> Unit) { var threw = false; try { body() } catch (_: IllegalArgumentException) { threw = true }; check(threw) }
  val vector = BeaconFrame.encode(byteArrayOf(0x61, 0x62, 0x63), 0x12345678, 20)
  check(vector.single().contentEquals(byteArrayOf(0xB7.toByte(), 1, 0x12, 0x34, 0x56, 0x78, 0, 0, 0, 1, 0, 3, 0x61, 0x62, 0x63)))
  for (size in listOf(1, 8, 9, 170, 171, 1000, 16384)) for (limit in listOf(20, 182, 244, 512)) {
    val source = ByteArray(size) { it.toByte() }; val rx = BeaconReassembler(); var result: ByteArray? = null
    BeaconFrame.encode(source, 42, limit).forEach { check(it.size <= limit); result = rx.accept(it) }
    check(result!!.contentEquals(source))
  }
  reject { BeaconFrame.encode(byteArrayOf(), 0, 20) }
  reject { BeaconFrame.encode(ByteArray(16385), 0, 20) }
  reject { BeaconFrame.encode(byteArrayOf(1), 0, 12) }
  reject { BeaconReassembler().accept(byteArrayOf(0)) }
  val two = BeaconFrame.encode(ByteArray(10), 1, 20)
  reject { BeaconReassembler().accept(two[1]) }
  val dup = BeaconReassembler(); dup.accept(two[0]); reject { dup.accept(two[0]) }
  val bounded = BeaconReassembler()
  for (id in 1..2) bounded.accept(BeaconFrame.encode(ByteArray(9), id, 20)[0])
  reject { bounded.accept(BeaconFrame.encode(ByteArray(9), 3, 20)[0]) }
  bounded.expire(System.nanoTime() + 91_000_000_000L)
  bounded.accept(BeaconFrame.encode(ByteArray(9), 3, 20)[0])
  val corrupt = vector.single().copyOf(); corrupt[1] = 2
  reject { BeaconReassembler().accept(corrupt) }
  var clock = 100_000_000_000L
  val deadline = BeaconReassembler { clock }
  deadline.accept(two[0]); clock += 89_999_999_999L
  check(deadline.accept(two[1])!!.contentEquals(ByteArray(10)))
  deadline.accept(two[0]); clock += 90_000_000_000L
  reject { deadline.accept(two[1]) }
  // A corrupt continuation discards only its partial and permits a whole retry.
  val recovery = BeaconReassembler(); recovery.accept(two[0])
  val mismatched = two[1].copyOf(); mismatched[11] = 11
  reject { recovery.accept(mismatched) }
  recovery.accept(two[0]); check(recovery.accept(two[1])!!.contentEquals(ByteArray(10)))
  println("Beacon Kotlin framing: 28 round-trips, wire vector, size/order/duplicate/version/capacity/monotonic timeout/recovery checks passed")
}
