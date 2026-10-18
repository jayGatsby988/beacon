package expo.modules.beaconble

/** Monotonic-clock scan pacing, retained across stop/start and user refreshes. */
internal class BeaconScanPolicy {
  private var nextStartAt = 0L
  fun canStart(now: Long): Boolean = now >= nextStartAt
  fun started(now: Long) { nextStartAt = now + 10_000L }
  fun failed(now: Long, errorCode: Int) {
    // Android error 6 is SCAN_FAILED_SCANNING_TOO_FREQUENTLY (also on older OSes).
    nextStartAt = maxOf(nextStartAt, now + if (errorCode == 6) 30_000L else 10_000L)
  }
}
